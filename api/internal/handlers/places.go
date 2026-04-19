package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func PlacesHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodGet:
			places, err := db.GetSavedPlaces(database, userID)
			if err != nil {
				http.Error(w, "Failed to fetch places", http.StatusInternalServerError)
				return
			}

			json.NewEncoder(w).Encode(map[string]interface{}{
				"places": places,
			})

		case http.MethodPost:
			var req models.PlaceRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			if req.Name == "" || req.Latitude == 0 || req.Longitude == 0 {
				http.Error(w, "Missing required fields", http.StatusBadRequest)
				return
			}

			if err := db.SavePlace(database, userID, req); err != nil {
				http.Error(w, "Failed to save place", http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func PlaceByIDHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		placeID := r.PathValue("id")
		if placeID == "" {
			http.Error(w, "Missing place ID", http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodPatch:
			var req struct {
				Name string `json:"name"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}
			if err := db.UpdatePlace(database, userID, placeID, req.Name); err != nil {
				http.Error(w, "Failed to update place", http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "updated"})

		case http.MethodDelete:
			if err := db.DeletePlace(database, userID, placeID); err != nil {
				http.Error(w, "Failed to delete place", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}
