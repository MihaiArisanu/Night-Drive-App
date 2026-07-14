package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

type ZenStartRequest struct {
	Latitude            float64  `json:"latitude"`
	Longitude           float64  `json:"longitude"`
	Heading             float64  `json:"heading"`
	ExpectedWaypointLat *float64 `json:"expected_waypoint_lat,omitempty"`
	ExpectedWaypointLng *float64 `json:"expected_waypoint_lng,omitempty"`
}

type ZenEngineRequest struct {
	UserID     string  `json:"user_id"`
	CurrentLat float64 `json:"current_lat"`
	CurrentLng float64 `json:"current_lng"`
	Heading    float64 `json:"heading"`
}

type ZenWaypoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type ZenEngineResponse struct {
	Waypoints   []ZenWaypoint `json:"waypoints"`
	IsColdStart bool          `json:"is_cold_start"`
}

type ZenEngineError struct {
	StatusCode int
	Code       string
}

func (e *ZenEngineError) Error() string {
	return fmt.Sprintf("zen engine error %d: %s", e.StatusCode, e.Code)
}

type ZenSession struct {
	Waypoints      []ZenWaypoint `json:"waypoints"`
	CurrentWpIndex int           `json:"current_wp_index"`
	IsColdStart    bool          `json:"is_cold_start"`
}

func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

func fetchZenWaypoints(ctx context.Context, userID string, lat, lng, heading float64) (*ZenEngineResponse, error) {
	reqBody := ZenEngineRequest{
		UserID:     userID,
		CurrentLat: lat,
		CurrentLng: lng,
		Heading:    heading,
	}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("encode zen request: %w", err)
	}

	engineURL := os.Getenv("ZEN_ENGINE_URL")
	if engineURL == "" {
		engineURL = "http://zen-engine:8000"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, engineURL+"/generate-loop", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Secret", os.Getenv("INTERNAL_SECRET"))

	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var engineErrorResponse struct {
			Detail struct {
				Code string `json:"code"`
			} `json:"detail"`
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
		_ = json.Unmarshal(body, &engineErrorResponse)
		return nil, &ZenEngineError{
			StatusCode: resp.StatusCode,
			Code:       engineErrorResponse.Detail.Code,
		}
	}

	var engineResp ZenEngineResponse
	if err := json.NewDecoder(resp.Body).Decode(&engineResp); err != nil {
		return nil, err
	}
	return &engineResp, nil
}

func respondZenRouteError(w http.ResponseWriter, err error, extension bool) {
	var engineError *ZenEngineError
	if errors.As(err, &engineError) {
		switch engineError.Code {
		case "road_data_unavailable":
			RespondWithError(w, http.StatusServiceUnavailable, "road_data_unavailable", "Road network data is temporarily unavailable", err)
			return
		case "no_connected_corridor":
			RespondWithError(w, http.StatusUnprocessableEntity, "no_connected_corridor", "No connected main-road corridor was found nearby", err)
			return
		}
	}

	message := "No safe connected Zen route is currently available"
	if extension {
		message = "Could not safely extend the Zen route"
	}
	RespondWithError(w, http.StatusServiceUnavailable, "safe_route_unavailable", message, err)
}

func decodeZenStartRequest(r *http.Request) (ZenStartRequest, error) {
	var req ZenStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return ZenStartRequest{}, fmt.Errorf("decode zen request: %w", err)
	}
	if req.Latitude < -90 || req.Latitude > 90 || req.Longitude < -180 || req.Longitude > 180 {
		return ZenStartRequest{}, fmt.Errorf("coordinates are outside valid ranges")
	}
	if math.IsNaN(req.Latitude) || math.IsNaN(req.Longitude) || math.IsNaN(req.Heading) ||
		math.IsInf(req.Latitude, 0) || math.IsInf(req.Longitude, 0) || math.IsInf(req.Heading, 0) {
		return ZenStartRequest{}, fmt.Errorf("coordinates or heading are not finite")
	}
	if (req.ExpectedWaypointLat == nil) != (req.ExpectedWaypointLng == nil) {
		return ZenStartRequest{}, fmt.Errorf("expected waypoint coordinates must be provided together")
	}
	if req.ExpectedWaypointLat != nil {
		if *req.ExpectedWaypointLat < -90 || *req.ExpectedWaypointLat > 90 ||
			*req.ExpectedWaypointLng < -180 || *req.ExpectedWaypointLng > 180 ||
			math.IsNaN(*req.ExpectedWaypointLat) || math.IsNaN(*req.ExpectedWaypointLng) ||
			math.IsInf(*req.ExpectedWaypointLat, 0) || math.IsInf(*req.ExpectedWaypointLng, 0) {
			return ZenStartRequest{}, fmt.Errorf("expected waypoint coordinates are invalid")
		}
	}
	req.Heading = math.Mod(req.Heading, 360)
	if req.Heading < 0 {
		req.Heading += 360
	}
	return req, nil
}

func StartZenModeHandler(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		req, err := decodeZenStartRequest(r)
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_zen_request", "Invalid coordinates or heading", err)
			return
		}

		engineResp, err := fetchZenWaypoints(r.Context(), userID, req.Latitude, req.Longitude, req.Heading)
		if err != nil {
			respondZenRouteError(w, err, false)
			return
		}

		if len(engineResp.Waypoints) < 1 {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "No waypoints generated", nil)
			return
		}

		session := ZenSession{
			Waypoints:      engineResp.Waypoints,
			CurrentWpIndex: 0,
			IsColdStart:    engineResp.IsColdStart,
		}
		sessionBytes, err := json.Marshal(session)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to create Zen session", err)
			return
		}
		if err := rdb.Set(r.Context(), "zen_session:"+userID, sessionBytes, 4*time.Hour).Err(); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to persist Zen session", err)
			return
		}

		firstWp := engineResp.Waypoints[0]
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"next_lat":      firstWp.Lat,
			"next_lng":      firstWp.Lng,
			"is_cold_start": engineResp.IsColdStart,
		})
	}
}

func StopZenModeHandler(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if ok {
			rdb.Del(context.Background(), "zen_session:"+userID)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
	}
}

func SyncZenLocationHandler(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		req, err := decodeZenStartRequest(r)
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_zen_request", "Invalid coordinates or heading", err)
			return
		}

		ctx := r.Context()
		key := "zen_session:" + userID
		sessionData, err := rdb.Get(ctx, key).Result()
		if err == redis.Nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"status": "no_session"})
			return
		}
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load Zen session", err)
			return
		}

		var session ZenSession
		if err := json.Unmarshal([]byte(sessionData), &session); err != nil ||
			len(session.Waypoints) == 0 ||
			session.CurrentWpIndex < 0 ||
			session.CurrentWpIndex >= len(session.Waypoints) {
			rdb.Del(ctx, key)
			RespondWithError(w, http.StatusConflict, "invalid_zen_session", "Zen session is invalid; start it again", err)
			return
		}

		currentWp := session.Waypoints[session.CurrentWpIndex]
		if req.ExpectedWaypointLat != nil && haversine(
			*req.ExpectedWaypointLat,
			*req.ExpectedWaypointLng,
			currentWp.Lat,
			currentWp.Lng,
		) > 25.0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":   "stale",
				"next_lat": currentWp.Lat,
				"next_lng": currentWp.Lng,
			})
			return
		}
		dist := haversine(req.Latitude, req.Longitude, currentWp.Lat, currentWp.Lng)

		w.Header().Set("Content-Type", "application/json")

		if dist < 500.0 {
			nextIdx := session.CurrentWpIndex + 1

			if nextIdx >= len(session.Waypoints) {
				lastWp := session.Waypoints[len(session.Waypoints)-1]
				engineResp, err := fetchZenWaypoints(ctx, userID, lastWp.Lat, lastWp.Lng, req.Heading)
				if err != nil || len(engineResp.Waypoints) < 1 {
					respondZenRouteError(w, err, true)
					return
				}
				session.Waypoints = engineResp.Waypoints
				session.CurrentWpIndex = 0
			} else {
				session.CurrentWpIndex = nextIdx
			}

			nextWp := session.Waypoints[session.CurrentWpIndex]
			sessionBytes, err := json.Marshal(session)
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update Zen session", err)
				return
			}
			if err := rdb.Set(ctx, key, sessionBytes, 4*time.Hour).Err(); err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update Zen session", err)
				return
			}

			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":   "extended",
				"next_lat": nextWp.Lat,
				"next_lng": nextWp.Lng,
			})
		} else {
			json.NewEncoder(w).Encode(map[string]string{"status": "active"})
		}
	}
}
