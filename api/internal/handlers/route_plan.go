package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/routing"
)

const (
	dislikedAreaRadiusMeters = 200.0
	maxRouteWaypoints        = 8
)

type RoutePlanRequest struct {
	Origin      models.Coordinates   `json:"origin"`
	Destination models.Coordinates   `json:"destination"`
	Waypoints   []models.Coordinates `json:"waypoints"`
}

func PlanRouteHandler(database *sql.DB, planner routing.Planner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		var request RoutePlanRequest
		decoder := json.NewDecoder(io.LimitReader(r.Body, 64*1024))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_route_request", "Invalid route request", err)
			return
		}
		if !validCoordinates(request.Origin) || !validCoordinates(request.Destination) ||
			len(request.Waypoints) > maxRouteWaypoints {
			RespondWithError(w, http.StatusBadRequest, "invalid_route_request", "Invalid route coordinates or too many waypoints", nil)
			return
		}
		for _, waypoint := range request.Waypoints {
			if !validCoordinates(waypoint) {
				RespondWithError(w, http.StatusBadRequest, "invalid_route_request", "Invalid waypoint coordinates", nil)
				return
			}
		}

		dislikedAreas, err := db.GetDislikedAreas(database, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load disliked streets", err)
			return
		}
		zones := make([]routing.AvoidanceZone, 0, len(dislikedAreas))
		for _, area := range dislikedAreas {
			zone := routing.AvoidanceZone{
				Center: routing.Coordinate{
					Latitude:  area.Latitude,
					Longitude: area.Longitude,
				},
				RadiusMeters: area.AvoidanceRadiusMeters,
			}
			if zone.RadiusMeters <= 0 {
				zone.RadiusMeters = dislikedAreaRadiusMeters
			}
			for _, path := range area.Paths {
				routePath := make([]routing.Coordinate, 0, len(path))
				for _, point := range path {
					routePath = append(routePath, toRoutingCoordinate(point))
				}
				if len(routePath) >= 2 {
					zone.Paths = append(zone.Paths, routePath)
				}
			}
			zones = append(zones, zone)
		}

		waypoints := make([]routing.Coordinate, 0, len(request.Waypoints))
		for _, waypoint := range request.Waypoints {
			waypoints = append(waypoints, toRoutingCoordinate(waypoint))
		}
		routeContext, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		result, err := planner.Plan(routeContext, routing.PlanRequest{
			Origin:      toRoutingCoordinate(request.Origin),
			Destination: toRoutingCoordinate(request.Destination),
			Waypoints:   waypoints,
		}, zones)
		if err != nil {
			switch {
			case errors.Is(err, routing.ErrNoCompliantRoute):
				RespondWithError(w, http.StatusUnprocessableEntity, "no_route_around_dislikes", "No driving route can safely avoid your disliked streets", err)
			case errors.Is(err, routing.ErrNoRoute):
				RespondWithError(w, http.StatusUnprocessableEntity, "route_not_found", "No driving route was found", err)
			case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
				RespondWithError(w, http.StatusGatewayTimeout, "routing_timeout", "Route planning timed out", err)
			default:
				RespondWithError(w, http.StatusBadGateway, "routing_unavailable", "Route planning is temporarily unavailable", err)
			}
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"coordinates":     result.Coordinates,
			"distance":        float64(result.DistanceMeters) / 1000,
			"duration":        float64(result.DurationSeconds) / 60,
			"used_detour":     result.UsedDetour,
			"avoidance_zones": len(zones),
		})
	}
}

func validCoordinates(coordinates models.Coordinates) bool {
	return coordinates.Latitude >= -90 && coordinates.Latitude <= 90 &&
		coordinates.Longitude >= -180 && coordinates.Longitude <= 180 &&
		!math.IsNaN(coordinates.Latitude) && !math.IsNaN(coordinates.Longitude) &&
		!math.IsInf(coordinates.Latitude, 0) && !math.IsInf(coordinates.Longitude, 0)
}

func toRoutingCoordinate(coordinates models.Coordinates) routing.Coordinate {
	return routing.Coordinate{
		Latitude:  coordinates.Latitude,
		Longitude: coordinates.Longitude,
	}
}
