package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

type ZenStartRequest struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Heading   float64 `json:"heading"`
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

func fetchZenWaypoints(userID string, lat, lng, heading float64) (*ZenEngineResponse, error) {
	reqBody := ZenEngineRequest{
		UserID:     userID,
		CurrentLat: lat,
		CurrentLng: lng,
		Heading:    heading,
	}
	jsonData, _ := json.Marshal(reqBody)

	engineURL := os.Getenv("ZEN_ENGINE_URL")
	if engineURL == "" {
		engineURL = "http://zen-engine:8000"
	}

	req, err := http.NewRequest("POST", engineURL+"/generate-loop", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Secret", os.Getenv("INTERNAL_SECRET"))

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("zen engine returned status: %d", resp.StatusCode)
	}

	var engineResp ZenEngineResponse
	if err := json.NewDecoder(resp.Body).Decode(&engineResp); err != nil {
		return nil, err
	}
	return &engineResp, nil
}

func StartZenModeHandler(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var req ZenStartRequest
		json.NewDecoder(r.Body).Decode(&req)

		engineResp, err := fetchZenWaypoints(userID, req.Latitude, req.Longitude, req.Heading)
		if err != nil {
			http.Error(w, "Zen Engine unreachable", http.StatusServiceUnavailable)
			return
		}

		if len(engineResp.Waypoints) < 1 {
			http.Error(w, "No waypoints generated", http.StatusInternalServerError)
			return
		}

		// Store all waypoints in Redis, start at index 0
		session := ZenSession{
			Waypoints:      engineResp.Waypoints,
			CurrentWpIndex: 0,
			IsColdStart:    engineResp.IsColdStart,
		}
		sessionBytes, _ := json.Marshal(session)
		rdb.Set(context.Background(), "zen_session:"+userID, sessionBytes, 4*time.Hour)

		// Return ONLY the first waypoint — client navigates one step at a time
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
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var req ZenStartRequest
		json.NewDecoder(r.Body).Decode(&req)

		ctx := context.Background()
		key := "zen_session:" + userID
		sessionData, err := rdb.Get(ctx, key).Result()
		if err != nil {
			json.NewEncoder(w).Encode(map[string]string{"status": "no_session"})
			return
		}

		var session ZenSession
		json.Unmarshal([]byte(sessionData), &session)

		currentWp := session.Waypoints[session.CurrentWpIndex]
		dist := haversine(req.Latitude, req.Longitude, currentWp.Lat, currentWp.Lng)

		w.Header().Set("Content-Type", "application/json")

		if dist < 500.0 {
			// Advance to next waypoint
			nextIdx := session.CurrentWpIndex + 1

			if nextIdx >= len(session.Waypoints) {
				// Ran out of waypoints — generate a new set from current position
				lastWp := session.Waypoints[len(session.Waypoints)-1]
				engineResp, err := fetchZenWaypoints(userID, lastWp.Lat, lastWp.Lng, req.Heading)
				if err != nil || len(engineResp.Waypoints) < 1 {
					json.NewEncoder(w).Encode(map[string]string{"status": "active"})
					return
				}
				session.Waypoints = engineResp.Waypoints
				session.CurrentWpIndex = 0
			} else {
				session.CurrentWpIndex = nextIdx
			}

			nextWp := session.Waypoints[session.CurrentWpIndex]
			sessionBytes, _ := json.Marshal(session)
			rdb.Set(ctx, key, sessionBytes, 4*time.Hour)

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
