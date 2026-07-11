package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
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

		payload.ReceiverTag = strings.TrimSpace(strings.TrimPrefix(payload.ReceiverTag, "#"))
		if len(payload.ReceiverTag) < 4 {
			RespondWithError(w, http.StatusBadRequest, "invalid_tag", "Invalid recipient TAG", nil)
			return
		}

		result, err := db.SendFriendRequest(r.Context(), database, userID, payload.ReceiverTag)
		if err != nil {
			switch {
			case errors.Is(err, db.ErrUserNotFound):
				RespondWithError(w, http.StatusNotFound, "user_not_found", "User not found", nil)
			case errors.Is(err, db.ErrSelfRequest):
				RespondWithError(w, http.StatusConflict, "self_request", "Cannot send request to yourself", nil)
			case errors.Is(err, db.ErrAlreadyFriends):
				RespondWithError(w, http.StatusConflict, "already_friends", "Already friends", nil)
			case errors.Is(err, db.ErrRequestAlreadyPending):
				RespondWithError(w, http.StatusConflict, "friend_request_pending", "Friend request already pending", nil)
			case errors.Is(err, db.ErrIncomingRequestPending):
				RespondWithError(w, http.StatusConflict, "incoming_friend_request_pending", "This driver already sent you a friend request", nil)
			default:
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to send friend request", err)
			}
			return
		}

		w.Header().Set("Content-Type", "application/json")
		statusCode := http.StatusCreated
		if result.Status == "friendship_repaired" {
			statusCode = http.StatusOK
		}
		w.WriteHeader(statusCode)
		json.NewEncoder(w).Encode(struct {
			Success   bool                          `json:"success"`
			Status    string                        `json:"status"`
			Name      string                        `json:"name"`
			Recipient models.FriendRequestRecipient `json:"recipient"`
		}{
			Success:   true,
			Status:    result.Status,
			Name:      result.Recipient.Name,
			Recipient: result.Recipient,
		})
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

		reqs, err := db.GetPendingFriendRequests(r.Context(), database, userID)
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

		requestID := r.PathValue("id")

		if requestID == "" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid ID in URL", nil)
			return
		}

		var actionReq models.FriendRequestAction
		if err := json.NewDecoder(r.Body).Decode(&actionReq); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid payload", nil)
			return
		}

		if actionReq.Action != "accept" && actionReq.Action != "reject" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid action", nil)
			return
		}

		err := db.RespondFriendRequest(r.Context(), database, requestID, userID, actionReq.Action)
		if err != nil {
			if errors.Is(err, db.ErrRequestNotFound) {
				RespondWithError(w, http.StatusNotFound, "friend_request_not_found", "Pending request not found", nil)
				return
			}
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Database error", err)
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

		friends, err := db.GetFriends(r.Context(), database, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to get friends", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(friends)
	}
}
