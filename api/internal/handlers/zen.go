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
}

type ZenEngineRequest struct {
	UserID     string  `json:"user_id"`
	CurrentLat float64 `json:"current_lat"`
	CurrentLng float64 `json:"current_lng"`
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
	Waypoint3 ZenWaypoint `json:"waypoint_3"`
	Waypoint4 ZenWaypoint `json:"waypoint_4"`
}

type GoogleDirectionsResponse struct {
	Routes []struct {
		OverviewPolyline struct {
			Points string `json:"points"`
		} `json:"overview_polyline"`
	} `json:"routes"`
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

func fetchZenWaypoints(userID string, lat, lng float64) (*ZenEngineResponse, error) {
	reqBody := ZenEngineRequest{
		UserID:     userID,
		CurrentLat: lat,
		CurrentLng: lng,
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

func fetchGoogleRoute(originLat, originLng float64, wps []ZenWaypoint) (string, error) {
	apiKey := os.Getenv("GOOGLE_MAPS_API_KEY")
	if len(wps) < 4 {
		return "", fmt.Errorf("insufficient waypoints")
	}

	url := fmt.Sprintf(
		"https://maps.googleapis.com/maps/api/directions/json?origin=%f,%f&destination=%f,%f&waypoints=%f,%f|%f,%f|%f,%f&key=%s",
		originLat, originLng,
		wps[3].Lat, wps[3].Lng,
		wps[0].Lat, wps[0].Lng,
		wps[1].Lat, wps[1].Lng,
		wps[2].Lat, wps[2].Lng,
		apiKey,
	)

	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var dirResp GoogleDirectionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&dirResp); err != nil {
		return "", err
	}

	if len(dirResp.Routes) > 0 {
		return dirResp.Routes[0].OverviewPolyline.Points, nil
	}
	return "", fmt.Errorf("no route found")
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

		engineResp, err := fetchZenWaypoints(userID, req.Latitude, req.Longitude)
		if err != nil {
			http.Error(w, "Zen Engine unreachable", http.StatusServiceUnavailable)
			return
		}

		polyline, err := fetchGoogleRoute(req.Latitude, req.Longitude, engineResp.Waypoints)
		if err != nil {
			http.Error(w, "Routing failed", http.StatusInternalServerError)
			return
		}

		session := ZenSession{
			Waypoint3: engineResp.Waypoints[2],
			Waypoint4: engineResp.Waypoints[3],
		}
		sessionBytes, _ := json.Marshal(session)
		rdb.Set(context.Background(), "zen_session:"+userID, sessionBytes, 4*time.Hour)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"polyline":      polyline,
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

		dist := haversine(req.Latitude, req.Longitude, session.Waypoint3.Lat, session.Waypoint3.Lng)

		if dist < 500.0 {
			engineResp, err := fetchZenWaypoints(userID, session.Waypoint4.Lat, session.Waypoint4.Lng)
			if err == nil && len(engineResp.Waypoints) >= 4 {
				polyline, err := fetchGoogleRoute(session.Waypoint4.Lat, session.Waypoint4.Lng, engineResp.Waypoints)
				if err == nil {
					session.Waypoint3 = engineResp.Waypoints[2]
					session.Waypoint4 = engineResp.Waypoints[3]
					sessionBytes, _ := json.Marshal(session)
					rdb.Set(ctx, key, sessionBytes, 4*time.Hour)

					w.Header().Set("Content-Type", "application/json")
					json.NewEncoder(w).Encode(map[string]interface{}{
						"status":       "extended",
						"new_polyline": polyline,
					})
					return
				}
			}
		}

		json.NewEncoder(w).Encode(map[string]string{"status": "active"})
	}
}
