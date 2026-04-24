package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func SendFriendRequestHandler(database *sql.DB) http.HandlerFunc {
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

		var payload models.FriendRequestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "Invalid payload", http.StatusBadRequest)
			return
		}

		err := db.SendFriendRequest(database, userID, payload.ReceiverTag)
		if err != nil {
			errStr := err.Error()
			if strings.Contains(errStr, "not_found") {
				w.WriteHeader(http.StatusNotFound)
				json.NewEncoder(w).Encode(map[string]string{"message": "User not found"})
				return
			}
			if strings.Contains(errStr, "self") {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"message": "Cannot send request to yourself"})
				return
			}
			if strings.Contains(errStr, "already_friends") {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"message": "Already friends"})
				return
			}

			http.Error(w, "Failed to send friend request", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	}
}

func GetFriendRequestsHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		reqs, err := db.GetPendingFriendRequests(database, userID)
		if err != nil {
			http.Error(w, "Failed to get friend requests", http.StatusInternalServerError)
			return
		}

		if reqs == nil {
			reqs = []models.PendingFriendRequest{}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(reqs)
	}
}

func RespondFriendRequestHandler(database *sql.DB) http.HandlerFunc {
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

		pathParts := strings.Split(r.URL.Path, "/")
		if len(pathParts) < 5 {
			http.Error(w, "Invalid path", http.StatusBadRequest)
			return
		}
		requestID := pathParts[4]

		var actionReq models.FriendRequestAction
		if err := json.NewDecoder(r.Body).Decode(&actionReq); err != nil {
			http.Error(w, "Invalid payload", http.StatusBadRequest)
			return
		}

		if actionReq.Action != "accept" && actionReq.Action != "reject" {
			http.Error(w, "Invalid action", http.StatusBadRequest)
			return
		}

		err := db.RespondFriendRequest(database, requestID, userID, actionReq.Action)
		if err != nil {
			if strings.Contains(err.Error(), "not_found") {
				http.Error(w, "Request not found", http.StatusNotFound)
				return
			}
			if strings.Contains(err.Error(), "already_answered") {
				http.Error(w, "Request already answered", http.StatusConflict)
				return
			}
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	}
}

func GetAllFriendsHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		friends, err := db.GetFriends(database, userID)
		if err != nil {
			http.Error(w, "Failed to get friends: "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(friends)
	}
}
