package streets

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func TestOverpassResolverReturnsConnectedGeometryForSelectedStreet(t *testing.T) {
	client := &http.Client{Transport: streetRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read Overpass request: %v", err)
		}
		form, err := url.ParseQuery(string(body))
		if err != nil {
			t.Fatalf("parse Overpass request: %v", err)
		}
		query := form.Get("data")
		var elements []overpassElement
		if strings.Contains(query, `[name="Bulevardul Libertății"]`) {
			elements = []overpassElement{
				testWay("Bulevardul Libertății", 45.0, 24.0, 45.0, 24.01),
				testWay("Bulevardul Libertății", 45.0, 24.01, 45.0, 24.02),
				testWay("Bulevardul Libertății", 45.2, 24.2, 45.2, 24.21),
			}
		} else {
			elements = []overpassElement{
				testWay("Bulevardul Libertății", 45.0, 24.0, 45.0, 24.01),
				testWay("Strada Independenței", 44.999, 24.005, 45.001, 24.005),
			}
		}
		var responseBody bytes.Buffer
		if err := json.NewEncoder(&responseBody).Encode(overpassResponse{Elements: elements}); err != nil {
			t.Fatalf("encode Overpass response: %v", err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(bytes.NewReader(responseBody.Bytes())),
			Request:    r,
		}, nil
	})}

	resolver := &OverpassResolver{urls: []string{"https://overpass.test/api"}, client: client}
	geometry, err := resolver.Resolve(context.Background(), Selection{
		Coordinates: models.Coordinates{Latitude: 45.0, Longitude: 24.005},
		Name:        "Bulevardul Libertății",
	})
	if err != nil {
		t.Fatalf("resolve street: %v", err)
	}
	if geometry.Name != "Bulevardul Libertății" {
		t.Fatalf("unexpected street name %q", geometry.Name)
	}
	if len(geometry.Paths) != 2 {
		t.Fatalf("expected two connected paths, got %d", len(geometry.Paths))
	}
}

func TestOverpassResolverRejectsAStreetNameThatDoesNotMatchNearbyRoads(t *testing.T) {
	client := &http.Client{Transport: streetRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		var responseBody bytes.Buffer
		json.NewEncoder(&responseBody).Encode(overpassResponse{Elements: []overpassElement{
			testWay("Strada Independenței", 45.0, 24.0, 45.0, 24.01),
		}})
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewReader(responseBody.Bytes())),
			Request:    r,
		}, nil
	})}

	resolver := &OverpassResolver{urls: []string{"https://overpass.test/api"}, client: client}
	_, err := resolver.Resolve(context.Background(), Selection{
		Coordinates: models.Coordinates{Latitude: 45.0, Longitude: 24.005},
		Name:        "Bulevardul Libertății",
	})
	if err != ErrStreetNotFound {
		t.Fatalf("expected ErrStreetNotFound, got %v", err)
	}
}

func TestOverpassResolverIntegration(t *testing.T) {
	if os.Getenv("RUN_OVERPASS_INTEGRATION") != "1" {
		t.Skip("set RUN_OVERPASS_INTEGRATION=1 to call Overpass")
	}
	resolver := NewOverpassResolver(os.Getenv("OVERPASS_URLS"), nil)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	geometry, err := resolver.Resolve(ctx, Selection{
		Coordinates: models.Coordinates{Latitude: 44.4549, Longitude: 26.0865},
		Name:        "Bulevardul Aviatorilor",
	})
	if err != nil {
		t.Fatalf("resolve real street: %v", err)
	}
	if geometry.Name == "" || len(geometry.Paths) == 0 {
		t.Fatalf("invalid real street geometry: %#v", geometry)
	}
}

type streetRoundTripFunc func(*http.Request) (*http.Response, error)

func (function streetRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func testWay(name string, coordinates ...float64) overpassElement {
	geometry := make([]overpassPoint, 0, len(coordinates)/2)
	for index := 0; index+1 < len(coordinates); index += 2 {
		geometry = append(geometry, overpassPoint{
			Latitude:  coordinates[index],
			Longitude: coordinates[index+1],
		})
	}
	return overpassElement{
		Type:     "way",
		Tags:     map[string]string{"name": name, "highway": "primary"},
		Geometry: geometry,
	}
}
