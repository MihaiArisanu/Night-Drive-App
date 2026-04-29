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
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodGet:
			places, err := db.GetSavedPlaces(database, userID)
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to fetch places", nil)
				return
			}

			json.NewEncoder(w).Encode(map[string]interface{}{
				"places": places,
			})

		case http.MethodPost:
			var req models.PlaceRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
				return
			}

			if req.Name == "" || req.Latitude == 0 || req.Longitude == 0 {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Missing required fields", nil)
				return
			}

			if err := db.SavePlace(database, userID, req); err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to save place", nil)
				return
			}

			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})

		default:
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
		}
	}
}

func PlaceByIDHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		placeID := r.PathValue("id")
		if placeID == "" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Missing place ID", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodPatch:
			var req struct {
				Name string `json:"name"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
				return
			}
			if err := db.UpdatePlace(database, userID, placeID, req.Name); err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update place", nil)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "updated"})

		case http.MethodDelete:
			if err := db.DeletePlace(database, userID, placeID); err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to delete place", nil)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
		}
	}
}
