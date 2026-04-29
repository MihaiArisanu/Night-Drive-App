package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func DislikesHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodGet:
			rows, err := database.Query(`
                SELECT id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, reason, created_at 
                FROM disliked_areas WHERE user_id = $1 ORDER BY created_at DESC`, userID)

			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to fetch disliked areas", nil)
				return
			}
			defer rows.Close()

			var dislikes []models.DislikeResponse
			for rows.Next() {
				var d models.DislikeResponse
				if err := rows.Scan(&d.ID, &d.Latitude, &d.Longitude, &d.Reason, &d.CreatedAt); err == nil {
					dislikes = append(dislikes, d)
				}
			}

			if dislikes == nil {
				dislikes = []models.DislikeResponse{}
			}

			json.NewEncoder(w).Encode(map[string]interface{}{
				"dislikes": dislikes,
			})

		case http.MethodPost:
			var req models.DislikeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
				return
			}

			if req.Latitude == 0 || req.Longitude == 0 {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Missing coordinates", nil)
				return
			}

			_, err := database.Exec(`
                INSERT INTO disliked_areas (user_id, location, reason) 
                VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4)`,
				userID, req.Longitude, req.Latitude, req.Reason)

			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to save disliked area", nil)
				return
			}

			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})

		default:
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
		}
	}
}

func DislikeByIDHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		dislikeID := r.PathValue("id")
		if dislikeID == "" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Missing dislike ID", nil)
			return
		}

		switch r.Method {
		case http.MethodDelete:
			_, err := database.Exec("DELETE FROM disliked_areas WHERE id = $1 AND user_id = $2", dislikeID, userID)
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to delete disliked area", nil)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})
		case http.MethodPatch:
			var req models.DislikeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
				return
			}

			_, err := database.Exec("UPDATE disliked_areas SET reason = $1 WHERE id = $2 AND user_id = $3", req.Reason, dislikeID, userID)
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update disliked area", nil)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})
		default:
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
		}
	}
}
