package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func LocationHistoryHandler(database *sql.DB) http.HandlerFunc {
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

		var points []models.LocationPoint
		if err := json.NewDecoder(r.Body).Decode(&points); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
			return
		}

		if len(points) == 0 {
			w.WriteHeader(http.StatusOK)
			return
		}

		if err := db.SaveLocationHistory(database, userID, points); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to save location history", nil)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}
}

func DislikedAreasHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodGet:
			areas, err := db.GetDislikedAreas(database, userID)
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to fetch disliked areas", nil)
				return
			}
			json.NewEncoder(w).Encode(map[string]interface{}{"areas": areas})

		case http.MethodPost:
			var req models.DislikedAreaRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
				return
			}

			if req.Latitude == 0 || req.Longitude == 0 || req.Reason == "" {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Missing required fields", nil)
				return
			}

			if err := db.SaveDislikedArea(database, userID, req); err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to save disliked area", nil)
				return
			}

			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})

		case http.MethodDelete:
			parts := strings.Split(r.URL.Path, "/")
			areaID := parts[len(parts)-1]
			if areaID == "" {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Missing area ID", nil)
				return
			}

			if err := db.DeleteDislikedArea(database, userID, areaID); err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to delete disliked area", nil)
				return
			}

			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})

		default:
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
		}
	}
}
