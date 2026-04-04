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
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var points []models.LocationPoint
		if err := json.NewDecoder(r.Body).Decode(&points); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if len(points) == 0 {
			w.WriteHeader(http.StatusOK)
			return
		}

		if err := db.SaveLocationHistory(database, userID, points); err != nil {
			http.Error(w, "Failed to save location history", http.StatusInternalServerError)
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
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodGet:
			areas, err := db.GetDislikedAreas(database, userID)
			if err != nil {
				http.Error(w, "Failed to fetch disliked areas", http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(map[string]interface{}{"areas": areas})

		case http.MethodPost:
			var req models.DislikedAreaRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			if req.Latitude == 0 || req.Longitude == 0 || req.Reason == "" {
				http.Error(w, "Missing required fields", http.StatusBadRequest)
				return
			}

			if err := db.SaveDislikedArea(database, userID, req); err != nil {
				http.Error(w, "Failed to save disliked area", http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})

		case http.MethodDelete:
			parts := strings.Split(r.URL.Path, "/")
			areaID := parts[len(parts)-1]
			if areaID == "" {
				http.Error(w, "Missing area ID", http.StatusBadRequest)
				return
			}

			if err := db.DeleteDislikedArea(database, userID, areaID); err != nil {
				http.Error(w, "Failed to delete disliked area", http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}
