package routing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultDirectionsURL        = "https://maps.googleapis.com/maps/api/directions/json"
	detourClearanceMeters       = 300.0
	maxDetourAttempts           = 4
	earthRadiusMeters           = 6_371_000.0
	minimumStreetOverlapMeters  = 75.0
	maximumParallelAngleDegrees = 35.0
	streetEndpointEscapeMeters  = 200.0
)

var (
	ErrNoRoute          = errors.New("no driving route was returned")
	ErrNoCompliantRoute = errors.New("no route avoids the user's blocked areas")
)

type Coordinate struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type AvoidanceZone struct {
	Center       Coordinate
	RadiusMeters float64
	Paths        [][]Coordinate
}

type PlanRequest struct {
	Origin      Coordinate
	Destination Coordinate
	Waypoints   []Coordinate
}

type PlanResult struct {
	Coordinates     []Coordinate `json:"coordinates"`
	DistanceMeters  int          `json:"distance_meters"`
	DurationSeconds int          `json:"duration_seconds"`
	UsedDetour      bool         `json:"used_detour"`
}

type Planner interface {
	Plan(context.Context, PlanRequest, []AvoidanceZone) (*PlanResult, error)
}

type GoogleDirectionsPlanner struct {
	apiKey  string
	baseURL string
	client  *http.Client
}

func NewGoogleDirectionsPlanner(apiKey string, client *http.Client) (*GoogleDirectionsPlanner, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("GOOGLE_MAPS_API_KEY is not configured")
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &GoogleDirectionsPlanner{
		apiKey:  apiKey,
		baseURL: defaultDirectionsURL,
		client:  client,
	}, nil
}

type routeWaypoint struct {
	Coordinate Coordinate
	Via        bool
}

type routeCandidate struct {
	coordinates     []Coordinate
	legs            [][]Coordinate
	distanceMeters  int
	durationSeconds int
}

type routeConflict struct {
	zone         AvoidanceZone
	legIndex     int
	segmentStart Coordinate
	segmentEnd   Coordinate
}

func (p *GoogleDirectionsPlanner) Plan(
	ctx context.Context,
	request PlanRequest,
	zones []AvoidanceZone,
) (*PlanResult, error) {
	effectiveZones := make([]AvoidanceZone, 0, len(zones))
	for _, zone := range zones {
		if zone.RadiusMeters <= 0 {
			continue
		}
		// Legacy point areas can be ignored when the user starts or finishes
		// inside them. Street corridors use a short endpoint allowance instead,
		// so the rest of a long street remains blocked.
		if len(zone.Paths) == 0 && (haversineMeters(request.Origin, zone.Center) <= zone.RadiusMeters ||
			haversineMeters(request.Destination, zone.Center) <= zone.RadiusMeters) {
			continue
		}
		effectiveZones = append(effectiveZones, zone)
	}

	waypoints := make([]routeWaypoint, 0, len(request.Waypoints))
	for _, waypoint := range request.Waypoints {
		waypoints = append(waypoints, routeWaypoint{Coordinate: waypoint})
	}

	candidates, err := p.fetchRoutes(
		ctx,
		request.Origin,
		request.Destination,
		waypoints,
		len(waypoints) == 0,
	)
	if err != nil {
		return nil, err
	}
	if candidate := bestCompliantCandidate(candidates, effectiveZones); candidate != nil {
		return candidate.result(false), nil
	}

	baseline := shortestCandidate(candidates)
	if baseline == nil {
		return nil, ErrNoRoute
	}
	conflict := firstRouteConflict(*baseline, effectiveZones)
	if conflict == nil {
		return nil, ErrNoCompliantRoute
	}

	detourCandidates := detourCoordinates(*conflict)
	var bestDetour *routeCandidate
	for index, detour := range detourCandidates {
		if index >= maxDetourAttempts {
			break
		}
		detourWaypoints := insertDetourWaypoint(waypoints, conflict.legIndex, detour)
		detourRoutes, fetchErr := p.fetchRoutes(
			ctx,
			request.Origin,
			request.Destination,
			detourWaypoints,
			false,
		)
		if fetchErr != nil {
			if errors.Is(fetchErr, context.Canceled) || errors.Is(fetchErr, context.DeadlineExceeded) {
				return nil, fetchErr
			}
			continue
		}
		candidate := bestCompliantCandidate(detourRoutes, effectiveZones)
		if candidate != nil && (bestDetour == nil || candidate.durationSeconds < bestDetour.durationSeconds) {
			bestDetour = candidate
		}
	}
	if bestDetour == nil {
		return nil, ErrNoCompliantRoute
	}
	return bestDetour.result(true), nil
}

func (candidate *routeCandidate) result(usedDetour bool) *PlanResult {
	return &PlanResult{
		Coordinates:     candidate.coordinates,
		DistanceMeters:  candidate.distanceMeters,
		DurationSeconds: candidate.durationSeconds,
		UsedDetour:      usedDetour,
	}
}

type googleDirectionsResponse struct {
	Status       string        `json:"status"`
	ErrorMessage string        `json:"error_message"`
	Routes       []googleRoute `json:"routes"`
}

type googleRoute struct {
	Legs             []googleLeg    `json:"legs"`
	OverviewPolyline googlePolyline `json:"overview_polyline"`
}

type googleLeg struct {
	Distance googleValue  `json:"distance"`
	Duration googleValue  `json:"duration"`
	Steps    []googleStep `json:"steps"`
}

type googleValue struct {
	Value int `json:"value"`
}

type googleStep struct {
	Polyline googlePolyline `json:"polyline"`
}

type googlePolyline struct {
	Points string `json:"points"`
}

func (p *GoogleDirectionsPlanner) fetchRoutes(
	ctx context.Context,
	origin Coordinate,
	destination Coordinate,
	waypoints []routeWaypoint,
	alternatives bool,
) ([]routeCandidate, error) {
	requestURL, err := url.Parse(p.baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse directions URL: %w", err)
	}
	query := requestURL.Query()
	query.Set("origin", formatCoordinate(origin))
	query.Set("destination", formatCoordinate(destination))
	query.Set("mode", "driving")
	query.Set("units", "metric")
	query.Set("alternatives", strconv.FormatBool(alternatives && len(waypoints) == 0))
	query.Set("key", p.apiKey)
	if len(waypoints) > 0 {
		formatted := make([]string, 0, len(waypoints))
		for _, waypoint := range waypoints {
			value := formatCoordinate(waypoint.Coordinate)
			if waypoint.Via {
				value = "via:" + value
			}
			formatted = append(formatted, value)
		}
		query.Set("waypoints", strings.Join(formatted, "|"))
	}
	requestURL.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build directions request: %w", err)
	}
	req.Header.Set("User-Agent", "NightDrive-API/1.0")

	response, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request Google directions: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Google directions returned HTTP %d", response.StatusCode)
	}

	var payload googleDirectionsResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode Google directions: %w", err)
	}
	if payload.Status == "ZERO_RESULTS" {
		return nil, ErrNoRoute
	}
	if payload.Status != "OK" {
		return nil, fmt.Errorf("Google directions status %s: %s", payload.Status, payload.ErrorMessage)
	}

	candidates := make([]routeCandidate, 0, len(payload.Routes))
	for _, route := range payload.Routes {
		candidate, decodeErr := decodeRoute(route)
		if decodeErr == nil && len(candidate.coordinates) >= 2 {
			candidates = append(candidates, candidate)
		}
	}
	if len(candidates) == 0 {
		return nil, ErrNoRoute
	}
	return candidates, nil
}

func decodeRoute(route googleRoute) (routeCandidate, error) {
	candidate := routeCandidate{}
	for _, leg := range route.Legs {
		legCoordinates := make([]Coordinate, 0)
		candidate.distanceMeters += leg.Distance.Value
		candidate.durationSeconds += leg.Duration.Value
		for _, step := range leg.Steps {
			coordinates, err := decodePolyline(step.Polyline.Points)
			if err != nil {
				return routeCandidate{}, err
			}
			legCoordinates = appendUniqueCoordinates(legCoordinates, coordinates...)
		}
		if len(legCoordinates) > 0 {
			candidate.legs = append(candidate.legs, legCoordinates)
			candidate.coordinates = appendUniqueCoordinates(candidate.coordinates, legCoordinates...)
		}
	}
	if len(candidate.coordinates) < 2 && route.OverviewPolyline.Points != "" {
		coordinates, err := decodePolyline(route.OverviewPolyline.Points)
		if err != nil {
			return routeCandidate{}, err
		}
		candidate.coordinates = coordinates
		candidate.legs = [][]Coordinate{coordinates}
	}
	return candidate, nil
}

func appendUniqueCoordinates(target []Coordinate, coordinates ...Coordinate) []Coordinate {
	for _, coordinate := range coordinates {
		if len(target) > 0 {
			last := target[len(target)-1]
			if last == coordinate {
				continue
			}
		}
		target = append(target, coordinate)
	}
	return target
}

func bestCompliantCandidate(candidates []routeCandidate, zones []AvoidanceZone) *routeCandidate {
	var best *routeCandidate
	for index := range candidates {
		if firstRouteConflict(candidates[index], zones) != nil {
			continue
		}
		if best == nil || candidates[index].durationSeconds < best.durationSeconds {
			best = &candidates[index]
		}
	}
	return best
}

func shortestCandidate(candidates []routeCandidate) *routeCandidate {
	var best *routeCandidate
	for index := range candidates {
		if best == nil || candidates[index].durationSeconds < best.durationSeconds {
			best = &candidates[index]
		}
	}
	return best
}

func firstRouteConflict(candidate routeCandidate, zones []AvoidanceZone) *routeConflict {
	streetOverlap := make([]float64, len(zones))
	totalDistance := candidateDistanceMeters(candidate)
	travelledDistance := 0.0
	origin, destination, hasEndpoints := candidateEndpoints(candidate)
	for legIndex, leg := range candidate.legs {
		for pointIndex := 0; pointIndex+1 < len(leg); pointIndex++ {
			segmentStart := leg[pointIndex]
			segmentEnd := leg[pointIndex+1]
			segmentDistance := haversineMeters(segmentStart, segmentEnd)
			for zoneIndex, zone := range zones {
				if len(zone.Paths) == 0 {
					if distancePointToSegmentMeters(zone.Center, segmentStart, segmentEnd) > zone.RadiusMeters {
						continue
					}
					return &routeConflict{
						zone:         zone,
						legIndex:     legIndex,
						segmentStart: segmentStart,
						segmentEnd:   segmentEnd,
					}
				}

				if !routeSegmentFollowsStreet(segmentStart, segmentEnd, zone) {
					continue
				}
				overlapDistance := segmentDistance
				if hasEndpoints {
					overlapDistance = streetOverlapOutsideEndpointAllowance(
						zone,
						origin,
						destination,
						travelledDistance,
						segmentDistance,
						totalDistance,
					)
				}
				streetOverlap[zoneIndex] += overlapDistance
				if streetOverlap[zoneIndex] < minimumStreetOverlapMeters {
					continue
				}
				conflictingZone := zone
				conflictingZone.Center = midpointCoordinate(segmentStart, segmentEnd)
				return &routeConflict{
					zone:         conflictingZone,
					legIndex:     legIndex,
					segmentStart: segmentStart,
					segmentEnd:   segmentEnd,
				}
			}
			travelledDistance += segmentDistance
		}
	}
	return nil
}

func routeSegmentFollowsStreet(start, end Coordinate, zone AvoidanceZone) bool {
	routeBearing := bearingDegrees(start, end)
	for _, path := range zone.Paths {
		for index := 0; index+1 < len(path); index++ {
			streetStart := path[index]
			streetEnd := path[index+1]
			if segmentToSegmentDistanceMeters(start, end, streetStart, streetEnd) > zone.RadiusMeters {
				continue
			}
			if parallelAngleDifference(routeBearing, bearingDegrees(streetStart, streetEnd)) <= maximumParallelAngleDegrees {
				return true
			}
		}
	}
	return false
}

func streetOverlapOutsideEndpointAllowance(
	zone AvoidanceZone,
	origin Coordinate,
	destination Coordinate,
	travelledDistance float64,
	segmentDistance float64,
	totalDistance float64,
) float64 {
	overlapDistance := segmentDistance
	originOnStreet := distancePointToPathsMeters(origin, zone.Paths) <= zone.RadiusMeters
	if originOnStreet && travelledDistance < streetEndpointEscapeMeters {
		originAllowance := streetEndpointEscapeMeters - travelledDistance
		overlapDistance -= math.Min(overlapDistance, originAllowance)
	}
	destinationOnStreet := distancePointToPathsMeters(destination, zone.Paths) <= zone.RadiusMeters
	remainingDistance := totalDistance - travelledDistance - segmentDistance
	if destinationOnStreet && remainingDistance < streetEndpointEscapeMeters {
		destinationAllowance := streetEndpointEscapeMeters - math.Max(0, remainingDistance)
		overlapDistance -= math.Min(overlapDistance, destinationAllowance)
	}
	return math.Max(0, overlapDistance)
}

func candidateEndpoints(candidate routeCandidate) (Coordinate, Coordinate, bool) {
	if len(candidate.coordinates) >= 2 {
		return candidate.coordinates[0], candidate.coordinates[len(candidate.coordinates)-1], true
	}
	for _, leg := range candidate.legs {
		if len(leg) >= 2 {
			return leg[0], leg[len(leg)-1], true
		}
	}
	return Coordinate{}, Coordinate{}, false
}

func candidateDistanceMeters(candidate routeCandidate) float64 {
	total := 0.0
	for _, leg := range candidate.legs {
		for index := 0; index+1 < len(leg); index++ {
			total += haversineMeters(leg[index], leg[index+1])
		}
	}
	return total
}

func distancePointToPathsMeters(point Coordinate, paths [][]Coordinate) float64 {
	minimum := math.Inf(1)
	for _, path := range paths {
		for index := 0; index+1 < len(path); index++ {
			minimum = math.Min(minimum, distancePointToSegmentMeters(point, path[index], path[index+1]))
		}
	}
	return minimum
}

func segmentToSegmentDistanceMeters(firstStart, firstEnd, secondStart, secondEnd Coordinate) float64 {
	firstStartX, firstStartY := projectMeters(firstStart, firstStart)
	firstEndX, firstEndY := projectMeters(firstEnd, firstStart)
	secondStartX, secondStartY := projectMeters(secondStart, firstStart)
	secondEndX, secondEndY := projectMeters(secondEnd, firstStart)
	if segmentsIntersect(
		firstStartX, firstStartY,
		firstEndX, firstEndY,
		secondStartX, secondStartY,
		secondEndX, secondEndY,
	) {
		return 0
	}
	return math.Min(
		math.Min(
			distanceCartesianPointToSegment(firstStartX, firstStartY, secondStartX, secondStartY, secondEndX, secondEndY),
			distanceCartesianPointToSegment(firstEndX, firstEndY, secondStartX, secondStartY, secondEndX, secondEndY),
		),
		math.Min(
			distanceCartesianPointToSegment(secondStartX, secondStartY, firstStartX, firstStartY, firstEndX, firstEndY),
			distanceCartesianPointToSegment(secondEndX, secondEndY, firstStartX, firstStartY, firstEndX, firstEndY),
		),
	)
}

func segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy float64) bool {
	const epsilon = 0.000001
	orientation := func(px, py, qx, qy, rx, ry float64) float64 {
		return (qx-px)*(ry-py) - (qy-py)*(rx-px)
	}
	onSegment := func(px, py, qx, qy, rx, ry float64) bool {
		return qx >= math.Min(px, rx)-epsilon && qx <= math.Max(px, rx)+epsilon &&
			qy >= math.Min(py, ry)-epsilon && qy <= math.Max(py, ry)+epsilon
	}
	first := orientation(ax, ay, bx, by, cx, cy)
	second := orientation(ax, ay, bx, by, dx, dy)
	third := orientation(cx, cy, dx, dy, ax, ay)
	fourth := orientation(cx, cy, dx, dy, bx, by)
	if first*second < 0 && third*fourth < 0 {
		return true
	}
	return (math.Abs(first) <= epsilon && onSegment(ax, ay, cx, cy, bx, by)) ||
		(math.Abs(second) <= epsilon && onSegment(ax, ay, dx, dy, bx, by)) ||
		(math.Abs(third) <= epsilon && onSegment(cx, cy, ax, ay, dx, dy)) ||
		(math.Abs(fourth) <= epsilon && onSegment(cx, cy, bx, by, dx, dy))
}

func distanceCartesianPointToSegment(px, py, ax, ay, bx, by float64) float64 {
	deltaX := bx - ax
	deltaY := by - ay
	lengthSquared := deltaX*deltaX + deltaY*deltaY
	if lengthSquared == 0 {
		return math.Hypot(px-ax, py-ay)
	}
	projection := ((px-ax)*deltaX + (py-ay)*deltaY) / lengthSquared
	projection = math.Max(0, math.Min(1, projection))
	return math.Hypot(px-(ax+projection*deltaX), py-(ay+projection*deltaY))
}

func bearingDegrees(first, second Coordinate) float64 {
	latitude1 := first.Latitude * math.Pi / 180
	latitude2 := second.Latitude * math.Pi / 180
	deltaLongitude := (second.Longitude - first.Longitude) * math.Pi / 180
	y := math.Sin(deltaLongitude) * math.Cos(latitude2)
	x := math.Cos(latitude1)*math.Sin(latitude2) -
		math.Sin(latitude1)*math.Cos(latitude2)*math.Cos(deltaLongitude)
	return math.Mod(math.Atan2(y, x)*180/math.Pi+360, 360)
}

func parallelAngleDifference(first, second float64) float64 {
	difference := math.Abs(math.Mod(first-second+540, 360) - 180)
	if difference > 90 {
		return 180 - difference
	}
	return difference
}

func midpointCoordinate(first, second Coordinate) Coordinate {
	return Coordinate{
		Latitude:  (first.Latitude + second.Latitude) / 2,
		Longitude: (first.Longitude + second.Longitude) / 2,
	}
}

func insertDetourWaypoint(
	waypoints []routeWaypoint,
	legIndex int,
	detour Coordinate,
) []routeWaypoint {
	insertAt := legIndex
	if insertAt < 0 {
		insertAt = 0
	}
	if insertAt > len(waypoints) {
		insertAt = len(waypoints)
	}
	result := make([]routeWaypoint, 0, len(waypoints)+1)
	result = append(result, waypoints[:insertAt]...)
	result = append(result, routeWaypoint{Coordinate: detour, Via: true})
	result = append(result, waypoints[insertAt:]...)
	return result
}

func detourCoordinates(conflict routeConflict) []Coordinate {
	startX, startY := projectMeters(conflict.segmentStart, conflict.zone.Center)
	endX, endY := projectMeters(conflict.segmentEnd, conflict.zone.Center)
	directionX := endX - startX
	directionY := endY - startY
	length := math.Hypot(directionX, directionY)
	if length < 1 {
		directionX, directionY, length = 1, 0, 1
	}
	perpendicularX := -directionY / length
	perpendicularY := directionX / length
	nearDistance := conflict.zone.RadiusMeters + detourClearanceMeters
	farDistance := nearDistance + 250

	return []Coordinate{
		unprojectMeters(perpendicularX*nearDistance, perpendicularY*nearDistance, conflict.zone.Center),
		unprojectMeters(-perpendicularX*nearDistance, -perpendicularY*nearDistance, conflict.zone.Center),
		unprojectMeters(perpendicularX*farDistance, perpendicularY*farDistance, conflict.zone.Center),
		unprojectMeters(-perpendicularX*farDistance, -perpendicularY*farDistance, conflict.zone.Center),
	}
}

func distancePointToSegmentMeters(point, start, end Coordinate) float64 {
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
	closestX := startX + projection*deltaX
	closestY := startY + projection*deltaY
	return math.Hypot(closestX, closestY)
}

func projectMeters(coordinate, origin Coordinate) (float64, float64) {
	latitudeRadians := origin.Latitude * math.Pi / 180
	x := (coordinate.Longitude - origin.Longitude) * math.Pi / 180 * earthRadiusMeters * math.Cos(latitudeRadians)
	y := (coordinate.Latitude - origin.Latitude) * math.Pi / 180 * earthRadiusMeters
	return x, y
}

func unprojectMeters(x, y float64, origin Coordinate) Coordinate {
	latitudeRadians := origin.Latitude * math.Pi / 180
	longitudeScale := math.Max(0.1, math.Cos(latitudeRadians))
	return Coordinate{
		Latitude:  origin.Latitude + y/earthRadiusMeters*180/math.Pi,
		Longitude: origin.Longitude + x/(earthRadiusMeters*longitudeScale)*180/math.Pi,
	}
}

func haversineMeters(first, second Coordinate) float64 {
	lat1 := first.Latitude * math.Pi / 180
	lat2 := second.Latitude * math.Pi / 180
	deltaLatitude := (second.Latitude - first.Latitude) * math.Pi / 180
	deltaLongitude := (second.Longitude - first.Longitude) * math.Pi / 180
	value := math.Sin(deltaLatitude/2)*math.Sin(deltaLatitude/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(deltaLongitude/2)*math.Sin(deltaLongitude/2)
	return earthRadiusMeters * 2 * math.Atan2(math.Sqrt(value), math.Sqrt(1-value))
}

func formatCoordinate(coordinate Coordinate) string {
	return strconv.FormatFloat(coordinate.Latitude, 'f', 7, 64) + "," +
		strconv.FormatFloat(coordinate.Longitude, 'f', 7, 64)
}

func decodePolyline(encoded string) ([]Coordinate, error) {
	coordinates := make([]Coordinate, 0)
	latitude, longitude := 0, 0
	for index := 0; index < len(encoded); {
		latitudeDelta, nextIndex, err := decodePolylineValue(encoded, index)
		if err != nil {
			return nil, err
		}
		index = nextIndex
		longitudeDelta, nextIndex, err := decodePolylineValue(encoded, index)
		if err != nil {
			return nil, err
		}
		index = nextIndex
		latitude += latitudeDelta
		longitude += longitudeDelta
		coordinates = append(coordinates, Coordinate{
			Latitude:  float64(latitude) / 1e5,
			Longitude: float64(longitude) / 1e5,
		})
	}
	return coordinates, nil
}

func decodePolylineValue(encoded string, start int) (int, int, error) {
	result, shift := 0, 0
	index := start
	for {
		if index >= len(encoded) || shift > 30 {
			return 0, index, errors.New("invalid encoded polyline")
		}
		value := int(encoded[index]) - 63
		index++
		result |= (value & 0x1f) << shift
		shift += 5
		if value < 0x20 {
			break
		}
	}
	if result&1 != 0 {
		return ^(result >> 1), index, nil
	}
	return result >> 1, index, nil
}
