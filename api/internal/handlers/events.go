package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func CreateEventHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req models.EventCreateRequest
		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			http.Error(w, "Invalid request payload", http.StatusBadRequest)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok {
			http.Error(w, "Server error: User ID not found in context", http.StatusInternalServerError)
			return
		}
		req.UserID = userID

		event, err := db.CreateEvent(database, &req)
		if err != nil {
			http.Error(w, "Failed to create event in database", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(event)
	}
}

func GetNearbyEventsHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		latStr := r.URL.Query().Get("lat")
		lat, err := strconv.ParseFloat(latStr, 64)
		if err != nil {
			http.Error(w, "Invalid 'lat' parameter", http.StatusBadRequest)
			return
		}

		lngStr := r.URL.Query().Get("lng")
		lng, err := strconv.ParseFloat(lngStr, 64)
		if err != nil {
			http.Error(w, "Invalid 'lng' parameter", http.StatusBadRequest)
			return
		}

		radiusStr := r.URL.Query().Get("radius")
		radius, err := strconv.ParseFloat(radiusStr, 64)
		if err != nil || radius == 0 {
			radius = 5000
		}

		events, err := db.GetNearbyEvents(database, lat, lng, radius)
		if err != nil {
			http.Error(w, "Failed to fetch events", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(events)
	}
}

func VoteEventHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req models.EventVoteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request payload", http.StatusBadRequest)
			return
		}

		if req.VoteType != "upvote" && req.VoteType != "downvote" {
			http.Error(w, "Invalid vote type. Must be 'upvote' or 'downvote'", http.StatusBadRequest)
			return
		}

		err := db.VoteEvent(database, req.EventID, req.VoteType)
		if err != nil {
			if err.Error() == "event not found" {
				http.Error(w, "Event not found", http.StatusNotFound)
				return
			}
			http.Error(w, "Failed to register vote", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status": "Vote registered successfully",
		})
	}
}
