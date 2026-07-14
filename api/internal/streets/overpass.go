package streets

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

const (
	discoveryRadiusMeters = 180
	coverageRadiusMeters  = 8_000
	connectionGapMeters   = 120.0
	maxOverpassBodyBytes  = 6 * 1024 * 1024
	maxStreetPaths        = 120
	earthRadiusMeters     = 6_371_000.0
)

const drivableRoadClasses = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service"

var defaultOverpassURLs = []string{
	"https://overpass-api.de/api/interpreter",
	"https://overpass.private.coffee/api/interpreter",
}

type OverpassResolver struct {
	urls   []string
	client *http.Client
}

func NewOverpassResolver(configuredURLs string, client *http.Client) *OverpassResolver {
	urls := make([]string, 0)
	for _, candidate := range strings.Split(configuredURLs, ",") {
		candidate = strings.TrimSpace(candidate)
		if parsed, err := url.Parse(candidate); err == nil && parsed.Scheme == "https" && parsed.Host != "" {
			urls = append(urls, candidate)
		}
	}
	if len(urls) == 0 {
		urls = append(urls, defaultOverpassURLs...)
	}
	if client == nil {
		client = &http.Client{Timeout: 12 * time.Second}
	}
	return &OverpassResolver{urls: urls, client: client}
}

type overpassResponse struct {
	Elements []overpassElement `json:"elements"`
}

type overpassElement struct {
	Type     string            `json:"type"`
	Tags     map[string]string `json:"tags"`
	Geometry []overpassPoint   `json:"geometry"`
}

type overpassPoint struct {
	Latitude  float64 `json:"lat"`
	Longitude float64 `json:"lon"`
}

type namedPath struct {
	name string
	path []models.Coordinates
}

func (resolver *OverpassResolver) Resolve(
	ctx context.Context,
	selection Selection,
) (Geometry, error) {
	discoveryQuery := fmt.Sprintf(`
[out:json][timeout:10];
way(around:%d,%s,%s)
  [highway~"^(%s)$"]
  [name];
out tags geom qt;`,
		discoveryRadiusMeters,
		formatNumber(selection.Latitude),
		formatNumber(selection.Longitude),
		drivableRoadClasses,
	)
	discovery, err := resolver.query(ctx, discoveryQuery)
	if err != nil {
		return Geometry{}, err
	}

	nearbyPaths := extractNamedPaths(discovery.Elements)
	streetName, ok := bestStreetName(selection, nearbyPaths)
	if !ok {
		return Geometry{}, ErrStreetNotFound
	}

	south, west, north, east := streetSearchBounds(
		selection.Latitude,
		selection.Longitude,
		coverageRadiusMeters,
	)
	coverageQuery := fmt.Sprintf(`
[out:json][timeout:12];
way
  [name="%s"]
  [highway~"^(%s)$"]
  (%s,%s,%s,%s);
out tags geom qt;`,
		escapeOverpassString(streetName),
		drivableRoadClasses,
		formatNumber(south),
		formatNumber(west),
		formatNumber(north),
		formatNumber(east),
	)
	coverage, err := resolver.query(ctx, coverageQuery)
	if err != nil {
		return Geometry{}, err
	}

	matchingPaths := make([][]models.Coordinates, 0)
	streetKey := normalizeName(streetName)
	for _, candidate := range extractNamedPaths(coverage.Elements) {
		if normalizeName(candidate.name) == streetKey {
			matchingPaths = append(matchingPaths, candidate.path)
		}
	}
	paths := connectedStreetPaths(selection.Coordinates, matchingPaths)
	if len(paths) == 0 {
		return Geometry{}, ErrStreetNotFound
	}
	return Geometry{Name: streetName, Paths: paths}, nil
}

func (resolver *OverpassResolver) query(
	ctx context.Context,
	query string,
) (overpassResponse, error) {
	type queryResult struct {
		payload overpassResponse
		err     error
	}
	queryContext, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan queryResult, len(resolver.urls))
	for index, endpoint := range resolver.urls {
		go func(index int, endpoint string) {
			if index > 0 {
				timer := time.NewTimer(time.Duration(index) * 750 * time.Millisecond)
				defer timer.Stop()
				select {
				case <-queryContext.Done():
					return
				case <-timer.C:
				}
			}
			payload, err := resolver.queryEndpoint(queryContext, endpoint, query)
			select {
			case results <- queryResult{payload: payload, err: err}:
			case <-queryContext.Done():
			}
		}(index, endpoint)
	}

	var lastError error
	for range resolver.urls {
		select {
		case <-ctx.Done():
			return overpassResponse{}, fmt.Errorf("%w: %v", ErrResolutionUnavailable, ctx.Err())
		case result := <-results:
			if result.err == nil {
				cancel()
				return result.payload, nil
			}
			lastError = result.err
		}
	}
	if lastError == nil {
		lastError = fmt.Errorf("no Overpass endpoints configured")
	}
	return overpassResponse{}, fmt.Errorf("%w: %v", ErrResolutionUnavailable, lastError)
}

func (resolver *OverpassResolver) queryEndpoint(
	ctx context.Context,
	endpoint string,
	query string,
) (overpassResponse, error) {
	form := url.Values{"data": []string{query}}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return overpassResponse{}, fmt.Errorf("build Overpass request: %w", err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("User-Agent", "NightDrive-API/1.0")

	response, err := resolver.client.Do(request)
	if err != nil {
		return overpassResponse{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(response.Body, 8*1024))
		return overpassResponse{}, fmt.Errorf("Overpass returned HTTP %d", response.StatusCode)
	}

	var payload overpassResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, maxOverpassBodyBytes)).Decode(&payload); err != nil {
		return overpassResponse{}, err
	}
	return payload, nil
}

func streetSearchBounds(latitude, longitude float64, radiusMeters float64) (float64, float64, float64, float64) {
	latitudeDelta := radiusMeters / 111_320.0
	longitudeScale := math.Max(0.2, math.Cos(latitude*math.Pi/180))
	longitudeDelta := radiusMeters / (111_320.0 * longitudeScale)
	return latitude - latitudeDelta,
		longitude - longitudeDelta,
		latitude + latitudeDelta,
		longitude + longitudeDelta
}

func extractNamedPaths(elements []overpassElement) []namedPath {
	paths := make([]namedPath, 0, len(elements))
	for _, element := range elements {
		if element.Type != "way" || strings.TrimSpace(element.Tags["name"]) == "" || len(element.Geometry) < 2 {
			continue
		}
		path := make([]models.Coordinates, 0, len(element.Geometry))
		for _, point := range element.Geometry {
			if point.Latitude < -90 || point.Latitude > 90 || point.Longitude < -180 || point.Longitude > 180 {
				continue
			}
			path = append(path, models.Coordinates{Latitude: point.Latitude, Longitude: point.Longitude})
		}
		if len(path) >= 2 {
			paths = append(paths, namedPath{name: element.Tags["name"], path: path})
		}
	}
	return paths
}

func bestStreetName(selection Selection, paths []namedPath) (string, bool) {
	type candidate struct {
		name       string
		score      float64
		similarity float64
	}
	candidates := make([]candidate, 0, len(paths))
	for _, path := range paths {
		similarity := nameSimilarity(selection.Name, path.name)
		if similarity < 0.45 {
			continue
		}
		distance := distancePointToPathMeters(selection.Coordinates, path.path)
		if distance > discoveryRadiusMeters {
			continue
		}
		candidates = append(candidates, candidate{
			name:       path.name,
			score:      distance - similarity*200.0,
			similarity: similarity,
		})
	}
	if len(candidates) == 0 {
		return "", false
	}
	sort.Slice(candidates, func(first, second int) bool {
		return candidates[first].score < candidates[second].score
	})
	if len(candidates) > 1 &&
		normalizeName(candidates[0].name) != normalizeName(candidates[1].name) &&
		math.Abs(candidates[0].score-candidates[1].score) < 8.0 &&
		math.Abs(candidates[0].similarity-candidates[1].similarity) < 0.05 {
		return "", false
	}
	return candidates[0].name, true
}

func connectedStreetPaths(
	selection models.Coordinates,
	paths [][]models.Coordinates,
) [][]models.Coordinates {
	if len(paths) == 0 {
		return nil
	}
	seed := 0
	seedDistance := math.Inf(1)
	for index, path := range paths {
		if distance := distancePointToPathMeters(selection, path); distance < seedDistance {
			seed = index
			seedDistance = distance
		}
	}

	included := make([]bool, len(paths))
	included[seed] = true
	changed := true
	for changed {
		changed = false
		for candidateIndex, candidate := range paths {
			if included[candidateIndex] {
				continue
			}
			for includedIndex, existing := range paths {
				if included[includedIndex] && pathsConnected(candidate, existing) {
					included[candidateIndex] = true
					changed = true
					break
				}
			}
		}
	}

	result := make([][]models.Coordinates, 0)
	for index, path := range paths {
		if included[index] {
			result = append(result, path)
			if len(result) >= maxStreetPaths {
				break
			}
		}
	}
	return result
}

func pathsConnected(first, second []models.Coordinates) bool {
	if len(first) == 0 || len(second) == 0 {
		return false
	}
	return distancePointToPathMeters(first[0], second) <= connectionGapMeters ||
		distancePointToPathMeters(first[len(first)-1], second) <= connectionGapMeters ||
		distancePointToPathMeters(second[0], first) <= connectionGapMeters ||
		distancePointToPathMeters(second[len(second)-1], first) <= connectionGapMeters
}

func distancePointToPathMeters(point models.Coordinates, path []models.Coordinates) float64 {
	minimum := math.Inf(1)
	for index := 0; index+1 < len(path); index++ {
		minimum = math.Min(minimum, distancePointToSegmentMeters(point, path[index], path[index+1]))
	}
	return minimum
}

func distancePointToSegmentMeters(point, start, end models.Coordinates) float64 {
	startX, startY := projectMeters(start, point)
	endX, endY := projectMeters(end, point)
	deltaX := endX - startX
	deltaY := endY - startY
	lengthSquared := deltaX*deltaX + deltaY*deltaY
	if lengthSquared == 0 {
		return math.Hypot(startX, startY)
	}
	projection := -(startX*deltaX + startY*deltaY) / lengthSquared
	projection = math.Max(0, math.Min(1, projection))
	return math.Hypot(
		startX+projection*deltaX,
		startY+projection*deltaY,
	)
}

func projectMeters(coordinate, origin models.Coordinates) (float64, float64) {
	latitudeRadians := origin.Latitude * math.Pi / 180
	return (coordinate.Longitude - origin.Longitude) * math.Pi / 180 * earthRadiusMeters * math.Cos(latitudeRadians),
		(coordinate.Latitude - origin.Latitude) * math.Pi / 180 * earthRadiusMeters
}

func nameSimilarity(first, second string) float64 {
	firstTokens := nameTokens(first)
	secondTokens := nameTokens(second)
	if len(firstTokens) == 0 || len(secondTokens) == 0 {
		return 0
	}
	intersection := 0
	union := make(map[string]struct{}, len(firstTokens)+len(secondTokens))
	for token := range firstTokens {
		union[token] = struct{}{}
		if _, ok := secondTokens[token]; ok {
			intersection++
		}
	}
	for token := range secondTokens {
		union[token] = struct{}{}
	}
	return float64(intersection) / float64(len(union))
}

func normalizeName(value string) string {
	tokens := nameTokens(value)
	values := make([]string, 0, len(tokens))
	for token := range tokens {
		values = append(values, token)
	}
	sort.Strings(values)
	return strings.Join(values, " ")
}

func nameTokens(value string) map[string]struct{} {
	replacer := strings.NewReplacer(
		"ă", "a", "â", "a", "î", "i", "ș", "s", "ş", "s", "ț", "t", "ţ", "t",
	)
	value = replacer.Replace(strings.ToLower(strings.TrimSpace(value)))
	value = strings.Map(func(character rune) rune {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			return character
		}
		return ' '
	}, value)
	ignored := map[string]struct{}{
		"strada": {}, "str": {}, "bulevardul": {}, "bulevard": {}, "bd": {}, "calea": {},
		"aleea": {}, "drumul": {}, "soseaua": {}, "sos": {},
	}
	tokens := make(map[string]struct{})
	for _, token := range strings.Fields(value) {
		if _, skip := ignored[token]; !skip {
			tokens[token] = struct{}{}
		}
	}
	return tokens
}

func escapeOverpassString(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	return value
}

func formatNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', 7, 64)
}
