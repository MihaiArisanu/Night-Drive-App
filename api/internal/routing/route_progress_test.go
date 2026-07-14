package routing

import "testing"

func TestIsPointAheadOnRoute(t *testing.T) {
	route := []Coordinate{
		{Latitude: 45, Longitude: 24.00},
		{Latitude: 45, Longitude: 24.05},
		{Latitude: 45, Longitude: 24.10},
	}

	ahead, measurable := IsPointAheadOnRoute(
		route,
		Coordinate{Latitude: 45, Longitude: 24.02},
		Coordinate{Latitude: 45, Longitude: 24.07},
		150,
	)
	if !measurable || !ahead {
		t.Fatalf("expected target to be measurably ahead, got ahead=%v measurable=%v", ahead, measurable)
	}

	ahead, measurable = IsPointAheadOnRoute(
		route,
		Coordinate{Latitude: 45, Longitude: 24.08},
		Coordinate{Latitude: 45, Longitude: 24.04},
		150,
	)
	if !measurable || ahead {
		t.Fatalf("expected target to be measurably behind, got ahead=%v measurable=%v", ahead, measurable)
	}
}

func TestIsPointAheadOnRouteRejectsUnrelatedRoute(t *testing.T) {
	route := []Coordinate{
		{Latitude: 45, Longitude: 24.00},
		{Latitude: 45, Longitude: 24.10},
	}

	_, measurable := IsPointAheadOnRoute(
		route,
		Coordinate{Latitude: 46, Longitude: 25},
		Coordinate{Latitude: 45, Longitude: 24.05},
		150,
	)
	if measurable {
		t.Fatal("expected a far-away route to be considered unreliable")
	}
}
