package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
)

func GetSocialNotificationCountHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		count, err := db.GetSocialNotificationCount(r.Context(), database, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to count notifications", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(count)
	}
}
