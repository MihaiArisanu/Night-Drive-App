package routing

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestBestCompliantCandidateSelectsSafeAlternative(t *testing.T) {
	zone := AvoidanceZone{
		Center:       Coordinate{Latitude: 45.0, Longitude: 24.02},
		RadiusMeters: 200,
	}
	blocked := routeCandidate{
		coordinates:     []Coordinate{{45.0, 24.0}, {45.0, 24.04}},
		legs:            [][]Coordinate{{{45.0, 24.0}, {45.0, 24.04}}},
		durationSeconds: 300,
	}
	safe := routeCandidate{
		coordinates: []Coordinate{
			{45.0, 24.0},
			{45.01, 24.02},
			{45.0, 24.04},
		},
		legs: [][]Coordinate{{
			{45.0, 24.0},
			{45.01, 24.02},
			{45.0, 24.04},
		}},
		durationSeconds: 420,
	}

	selected := bestCompliantCandidate([]routeCandidate{blocked, safe}, []AvoidanceZone{zone})

	if selected == nil || selected.durationSeconds != safe.durationSeconds {
		t.Fatalf("expected the safe alternative, got %#v", selected)
	}
}

func TestPlannerUsesOnlyAGeometricallyVerifiedDetour(t *testing.T) {
	origin := Coordinate{Latitude: 45.0, Longitude: 24.0}
	destination := Coordinate{Latitude: 45.0, Longitude: 24.04}
	blockedPath := []Coordinate{origin, {Latitude: 45.0, Longitude: 24.02}, destination}
	safePath := []Coordinate{origin, {Latitude: 45.01, Longitude: 24.02}, destination}
	requestCount := 0

	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		requestCount++
		path := blockedPath
		if r.URL.Query().Get("waypoints") != "" {
			path = safePath
		}
		response := googleDirectionsResponse{
			Status: "OK",
			Routes: []googleRoute{{
				Legs: []googleLeg{{
					Distance: googleValue{Value: 5_000},
					Duration: googleValue{Value: 600},
					Steps: []googleStep{{
						Polyline: googlePolyline{Points: encodeTestPolyline(path)},
					}},
				}},
			}},
		}
		var body bytes.Buffer
		if err := json.NewEncoder(&body).Encode(response); err != nil {
			t.Fatalf("encode fake response: %v", err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(bytes.NewReader(body.Bytes())),
			Request:    r,
		}, nil
	})

	planner, err := NewGoogleDirectionsPlanner("test-key", &http.Client{Transport: transport})
	if err != nil {
		t.Fatalf("create planner: %v", err)
	}
	planner.baseURL = "https://directions.test/route"

	result, err := planner.Plan(context.Background(), PlanRequest{
		Origin:      origin,
		Destination: destination,
	}, []AvoidanceZone{{
		Center:       Coordinate{Latitude: 45.0, Longitude: 24.02},
		RadiusMeters: 200,
	}})

	if err != nil {
		t.Fatalf("plan route: %v", err)
	}
	if !result.UsedDetour {
		t.Fatal("expected the planner to use a verified detour")
	}
	if requestCount < 2 {
		t.Fatalf("expected an initial route and detour request, got %d", requestCount)
	}
	candidate := routeCandidate{coordinates: result.Coordinates, legs: [][]Coordinate{result.Coordinates}}
	if firstRouteConflict(candidate, []AvoidanceZone{{
		Center:       Coordinate{Latitude: 45.0, Longitude: 24.02},
		RadiusMeters: 200,
	}}) != nil {
		t.Fatal("returned detour still intersects the blocked area")
	}
}

func TestDistancePointToSegmentDetectsSparsePolylineCrossing(t *testing.T) {
	distance := distancePointToSegmentMeters(
		Coordinate{Latitude: 45.0005, Longitude: 24.02},
		Coordinate{Latitude: 45.0, Longitude: 24.0},
		Coordinate{Latitude: 45.0, Longitude: 24.04},
	)
	if distance >= 60 {
		t.Fatalf("expected distance below 60m, got %.2fm", distance)
	}
}

func TestStreetCorridorBlocksParallelTravelButAllowsIntersectionCrossing(t *testing.T) {
	street := AvoidanceZone{
		Center:       Coordinate{Latitude: 45.0, Longitude: 24.02},
		RadiusMeters: 35,
		Paths: [][]Coordinate{{
			{Latitude: 45.0, Longitude: 24.0},
			{Latitude: 45.0, Longitude: 24.04},
		}},
	}
	parallelRoute := routeCandidate{
		coordinates: []Coordinate{
			{Latitude: 45.0001, Longitude: 24.0},
			{Latitude: 45.0001, Longitude: 24.04},
		},
		legs: [][]Coordinate{{
			{Latitude: 45.0001, Longitude: 24.0},
			{Latitude: 45.0001, Longitude: 24.04},
		}},
	}
	crossingRoute := routeCandidate{
		coordinates: []Coordinate{
			{Latitude: 44.99, Longitude: 24.02},
			{Latitude: 45.01, Longitude: 24.02},
		},
		legs: [][]Coordinate{{
			{Latitude: 44.99, Longitude: 24.02},
			{Latitude: 45.01, Longitude: 24.02},
		}},
	}

	if firstRouteConflict(parallelRoute, []AvoidanceZone{street}) == nil {
		t.Fatal("expected travel along the disliked street to be blocked")
	}
	if firstRouteConflict(crossingRoute, []AvoidanceZone{street}) != nil {
		t.Fatal("expected a perpendicular intersection crossing to remain allowed")
	}
}

func TestStreetEndpointAllowanceDoesNotDisableTheWholeStreet(t *testing.T) {
	street := AvoidanceZone{
		Center:       Coordinate{Latitude: 45.0, Longitude: 24.02},
		RadiusMeters: 35,
		Paths: [][]Coordinate{{
			{Latitude: 45.0, Longitude: 24.0},
			{Latitude: 45.0, Longitude: 24.04},
		}},
	}
	longRouteStartingOnStreet := routeCandidate{
		coordinates: []Coordinate{
			{Latitude: 45.0, Longitude: 24.0},
			{Latitude: 45.0, Longitude: 24.04},
		},
		legs: [][]Coordinate{{
			{Latitude: 45.0, Longitude: 24.0},
			{Latitude: 45.0, Longitude: 24.04},
		}},
	}

	if firstRouteConflict(longRouteStartingOnStreet, []AvoidanceZone{street}) == nil {
		t.Fatal("expected only the first 200m, not the entire street, to be allowed")
	}
}

func TestGoogleDirectionsIntegration(t *testing.T) {
	if os.Getenv("RUN_GOOGLE_DIRECTIONS_INTEGRATION") != "1" {
		t.Skip("set RUN_GOOGLE_DIRECTIONS_INTEGRATION=1 to call Google Directions")
	}
	planner, err := NewGoogleDirectionsPlanner(os.Getenv("GOOGLE_MAPS_API_KEY"), nil)
	if err != nil {
		t.Fatalf("create planner: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	result, err := planner.Plan(ctx, PlanRequest{
		Origin:      Coordinate{Latitude: 45.11216, Longitude: 24.363683},
		Destination: Coordinate{Latitude: 45.12175, Longitude: 24.363763},
	}, nil)
	if err != nil {
		t.Fatalf("plan real route: %v", err)
	}
	if len(result.Coordinates) < 2 || result.DistanceMeters <= 0 || result.DurationSeconds <= 0 {
		t.Fatalf("invalid real route result: %#v", result)
	}
}

func encodeTestPolyline(coordinates []Coordinate) string {
	result := make([]byte, 0)
	previousLatitude, previousLongitude := 0, 0
	for _, coordinate := range coordinates {
		latitude := int(coordinate.Latitude*1e5 + 0.5)
		longitude := int(coordinate.Longitude*1e5 + 0.5)
		result = append(result, encodeTestPolylineValue(latitude-previousLatitude)...)
		result = append(result, encodeTestPolylineValue(longitude-previousLongitude)...)
		previousLatitude, previousLongitude = latitude, longitude
	}
	return string(result)
}

func encodeTestPolylineValue(value int) []byte {
	value <<= 1
	if value < 0 {
		value = ^value
	}
	encoded := make([]byte, 0)
	for value >= 0x20 {
		encoded = append(encoded, byte((0x20|(value&0x1f))+63))
		value >>= 5
	}
	return append(encoded, byte(value+63))
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
