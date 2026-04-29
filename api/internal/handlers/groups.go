package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
	"github.com/google/uuid"
)

func AddGroupStopHandler(db *sql.DB, hub *ws.Hub) http.HandlerFunc {
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

		groupID := r.PathValue("id")
		if groupID == "" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Missing group ID", nil)
			return
		}

		var req models.GroupStopRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
			return
		}

		_, err := db.Exec(`
            INSERT INTO group_stops (group_id, added_by, name, location) 
            VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
			groupID, userID, req.Name, req.Longitude, req.Latitude)

		if err != nil {
			log.Printf("Eroare la salvarea opririi: %v", err)
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to save stop", nil)
			return
		}

		wsMessage := map[string]interface{}{
			"type":     "group_stop_added",
			"group_id": groupID,
			"payload": map[string]interface{}{
				"latitude":  req.Latitude,
				"longitude": req.Longitude,
				"name":      req.Name,
				"added_by":  userID,
			},
		}

		wsBytes, err := json.Marshal(wsMessage)
		if err == nil {
			hub.Broadcast <- wsBytes
		} else {
			log.Printf("Failed to marshal WS message: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"status": "Stop added and broadcasted"})
	}
}

func InviteGroupHandler(hub *ws.Hub) http.HandlerFunc {
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

		var req models.InviteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
			return
		}

		groupID := uuid.New().String()

		wsMessage := map[string]interface{}{
			"type": "RIDE_INVITE",
			"payload": map[string]interface{}{
				"friendName": req.SenderName,
				"distance":   "< 1 km",
				"eta":        "1 min",
				"groupId":    groupID,
			},
		}

		wsBytes, err := json.Marshal(wsMessage)
		if err == nil {
			hub.SendToUser(req.TargetUserId, wsBytes)
		} else {
			log.Printf("Failed to marshal invite WS message: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"groupId": groupID,
		})
	}
}

func JoinGroupHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
		})
	}
}
