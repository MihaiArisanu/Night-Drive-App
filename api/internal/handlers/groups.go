package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
)

func AddGroupStopHandler(db *sql.DB, hub *ws.Hub) http.HandlerFunc {
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

		groupID := r.PathValue("id")
		if groupID == "" {
			http.Error(w, "Missing group ID", http.StatusBadRequest)
			return
		}

		var req models.GroupStopRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		_, err := db.Exec(`
            INSERT INTO group_stops (group_id, added_by, name, location) 
            VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
			groupID, userID, req.Name, req.Longitude, req.Latitude)

		if err != nil {
			log.Printf("Eroare la salvarea opririi: %v", err)
			http.Error(w, "Failed to save stop", http.StatusInternalServerError)
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
