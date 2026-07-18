package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
)

type FCMTokenRequest struct {
	Token string `json:"token"`
}

func UpdateFCMTokenHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		var req FCMTokenRequest
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
			return
		}
		req.Token = strings.TrimSpace(req.Token)
		if len(req.Token) > 4096 {
			RespondWithError(w, http.StatusBadRequest, "invalid_fcm_token", "Invalid notification token", nil)
			return
		}

		err := db.UpdateFCMToken(r.Context(), database, userID, req.Token)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update token", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}
}
