package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
)

func CreateEventHandler(database *sql.DB, hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		var req models.EventCreateRequest
		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request payload", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Server error: User ID not found in context", nil)
			return
		}
		req.UserID = userID

		event, err := db.CreateEvent(database, &req)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to create event in database", nil)
			return
		}

		wsMessage := map[string]interface{}{
			"type": "new_event",
			"data": event,
		}

		wsBytes, err := json.Marshal(wsMessage)
		if err == nil {
			hub.Broadcast <- wsBytes
		} else {
			log.Printf("Failed to marshal websocket message: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(event)
	}
}

func GetNearbyEventsHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		latStr := r.URL.Query().Get("lat")
		lngStr := r.URL.Query().Get("lng")

		log.Printf("🔍 Cerere nearby: lat='%s', lng='%s'", latStr, lngStr)

		lat, err := strconv.ParseFloat(latStr, 64)
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid 'lat' parameter", nil)
			return
		}

		lng, err := strconv.ParseFloat(lngStr, 64)
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid 'lng' parameter", nil)
			return
		}

		radiusStr := r.URL.Query().Get("radius")
		radius, err := strconv.ParseFloat(radiusStr, 64)
		if err != nil || radius == 0 {
			radius = 5000
		}

		limitStr := r.URL.Query().Get("limit")
		pageStr := r.URL.Query().Get("page")

		limit, _ := strconv.Atoi(limitStr)
		if limit <= 0 || limit > 100 {
			limit = 50
		}

		page, _ := strconv.Atoi(pageStr)
		if page < 1 {
			page = 1
		}
		offset := (page - 1) * limit

		events, err := db.GetNearbyEvents(database, lat, lng, radius, limit, offset)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to fetch events", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(events)
	}
}

func VoteEventHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		var req models.EventVoteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request payload", nil)
			return
		}

		if req.VoteType != "upvote" && req.VoteType != "downvote" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid vote type. Must be 'upvote' or 'downvote'", nil)
			return
		}

		err := db.VoteEvent(database, req.EventID, req.VoteType)
		if err != nil {
			if err.Error() == "event not found" {
				RespondWithError(w, http.StatusNotFound, "api_error", "Event not found", nil)
				return
			}
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to register vote", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status": "Vote registered successfully",
		})
	}
}
