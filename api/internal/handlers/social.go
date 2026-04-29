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
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		var payload models.FriendRequestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid payload", nil)
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

			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to send friend request", nil)
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
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		reqs, err := db.GetPendingFriendRequests(database, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to get friend requests", nil)
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
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		pathParts := strings.Split(r.URL.Path, "/")
		if len(pathParts) < 5 {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid path", nil)
			return
		}
		requestID := pathParts[4]

		var actionReq models.FriendRequestAction
		if err := json.NewDecoder(r.Body).Decode(&actionReq); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid payload", nil)
			return
		}

		if actionReq.Action != "accept" && actionReq.Action != "reject" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid action", nil)
			return
		}

		err := db.RespondFriendRequest(database, requestID, userID, actionReq.Action)
		if err != nil {
			if strings.Contains(err.Error(), "not_found") {
				RespondWithError(w, http.StatusNotFound, "api_error", "Request not found", nil)
				return
			}
			if strings.Contains(err.Error(), "already_answered") {
				RespondWithError(w, http.StatusConflict, "api_error", "Request already answered", nil)
				return
			}
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Database error", nil)
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
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
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
