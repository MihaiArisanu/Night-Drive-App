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
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		switch r.Method {
		case http.MethodGet:
			rows, err := database.Query(`
                SELECT id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, reason, created_at 
                FROM disliked_areas WHERE user_id = $1 ORDER BY created_at DESC`, userID)

			if err != nil {
				http.Error(w, "Failed to fetch disliked areas", http.StatusInternalServerError)
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
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			if req.Latitude == 0 || req.Longitude == 0 {
				http.Error(w, "Missing coordinates", http.StatusBadRequest)
				return
			}

			_, err := database.Exec(`
                INSERT INTO disliked_areas (user_id, location, reason) 
                VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4)`,
				userID, req.Longitude, req.Latitude, req.Reason)

			if err != nil {
				http.Error(w, "Failed to save disliked area", http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func DislikeByIDHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		dislikeID := r.PathValue("id")
		if dislikeID == "" {
			http.Error(w, "Missing dislike ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodDelete:
			_, err := database.Exec("DELETE FROM disliked_areas WHERE id = $1 AND user_id = $2", dislikeID, userID)
			if err != nil {
				http.Error(w, "Failed to delete disliked area", http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})
		case http.MethodPatch:
			var req models.DislikeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			_, err := database.Exec("UPDATE disliked_areas SET reason = $1 WHERE id = $2 AND user_id = $3", req.Reason, dislikeID, userID)
			if err != nil {
				http.Error(w, "Failed to update disliked area", http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}
