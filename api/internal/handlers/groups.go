package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func AddGroupStopHandler(database *sql.DB, hub *ws.Hub) http.HandlerFunc {
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

		err := db.CreateGroupStop(r.Context(), database, groupID, userID, req.Name, req.Longitude, req.Latitude)
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

func InviteGroupHandler(database *sql.DB, hub *ws.Hub, rdb *redis.Client) http.HandlerFunc {
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
		if req.TargetUserId == "" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Target user is required", nil)
			return
		}
		if req.TargetUserId == userID {
			RespondWithError(w, http.StatusConflict, "self_invite", "Cannot invite yourself", nil)
			return
		}
		sender, err := db.GetUserByID(database, userID)
		if err != nil {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Sender account not found", err)
			return
		}
		if _, err := db.GetUserByID(database, req.TargetUserId); err != nil {
			RespondWithError(w, http.StatusNotFound, "target_not_found", "Target user not found", nil)
			return
		}

		groupID := req.GroupID
		if groupID == "" {
			groupID = uuid.New().String()
		} else if _, err := uuid.Parse(groupID); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_group_id", "Invalid group ID", nil)
			return
		}

		invite := models.GroupInvite{
			ID:           uuid.New().String(),
			GroupID:      groupID,
			SenderID:     userID,
			SenderName:   sender.Username,
			TargetUserID: req.TargetUserId,
			CreatedAt:    time.Now().UTC(),
		}
		if err := db.CreateGroupInvite(r.Context(), rdb, invite); err != nil {
			switch {
			case errors.Is(err, db.ErrGroupMemberExists):
				RespondWithError(w, http.StatusConflict, "group_member_exists", "This driver is already in the group", nil)
			case errors.Is(err, db.ErrGroupInvitePending):
				RespondWithError(w, http.StatusConflict, "group_invite_pending", "This driver already has a pending group invite", nil)
			case errors.Is(err, db.ErrGroupAccessDenied):
				RespondWithError(w, http.StatusForbidden, "group_access_denied", "You are not a member of this group", nil)
			default:
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to persist group invite", err)
			}
			return
		}

		wsMessage := map[string]interface{}{
			"type": "RIDE_INVITE",
			"payload": map[string]interface{}{
				"inviteId":   invite.ID,
				"senderId":   invite.SenderID,
				"senderName": invite.SenderName,
				"friendName": invite.SenderName,
				"distance":   "< 1 km",
				"eta":        "1 min",
				"groupId":    invite.GroupID,
				"createdAt":  invite.CreatedAt,
			},
		}

		deliveredLive := false
		wsBytes, err := json.Marshal(wsMessage)
		if err == nil {
			deliveredLive = hub.SendToUser(req.TargetUserId, wsBytes)
		} else {
			log.Printf("Failed to marshal invite WS message: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":       true,
			"groupId":       groupID,
			"inviteId":      invite.ID,
			"deliveredLive": deliveredLive,
		})
	}
}

func GetGroupDetailsHandler(database *sql.DB, rdb *redis.Client) http.HandlerFunc {
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
		groupID := r.PathValue("id")
		if _, err := uuid.Parse(groupID); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_group_id", "Invalid group ID", nil)
			return
		}

		ownerID, status, memberIDs, pendingIDs, err := db.GetRideGroupState(r.Context(), rdb, groupID, userID)
		if err != nil {
			switch {
			case errors.Is(err, db.ErrGroupNotFound):
				RespondWithError(w, http.StatusNotFound, "group_not_found", "Group not found or expired", nil)
			case errors.Is(err, db.ErrGroupAccessDenied):
				RespondWithError(w, http.StatusForbidden, "group_access_denied", "You are not a member of this group", nil)
			default:
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load group", err)
			}
			return
		}

		members, err := db.GetGroupParticipants(r.Context(), database, userID, memberIDs)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load group members", err)
			return
		}
		pending, err := db.GetGroupParticipants(r.Context(), database, userID, pendingIDs)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load pending members", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models.GroupDetails{
			ID:      groupID,
			OwnerID: ownerID,
			Status:  status,
			Members: members,
			Pending: pending,
		})
	}
}

func GetGroupInvitesHandler(rdb *redis.Client) http.HandlerFunc {
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
		invites, err := db.GetGroupInvites(r.Context(), rdb, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load group invites", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(invites)
	}
}

func DeleteGroupInviteHandler(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}
		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}
		inviteID := r.PathValue("id")
		if _, err := uuid.Parse(inviteID); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_invite_id", "Invalid invite ID", nil)
			return
		}
		if err := db.DeleteGroupInvite(r.Context(), rdb, userID, inviteID); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to delete group invite", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func JoinGroupHandler(rdb *redis.Client, hub *ws.Hub) http.HandlerFunc {
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
		if _, err := uuid.Parse(groupID); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_group_id", "Invalid group ID", nil)
			return
		}
		invite, err := db.AcceptGroupInvite(r.Context(), rdb, userID, groupID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to accept group invite", err)
			return
		}
		if invite == nil {
			RespondWithError(w, http.StatusNotFound, "group_invite_not_found", "Group invite not found or expired", nil)
			return
		}

		acceptedMessage, err := json.Marshal(map[string]interface{}{
			"type": "GROUP_INVITE_ACCEPTED",
			"payload": map[string]string{
				"groupId":        groupID,
				"acceptedUserId": userID,
			},
		})
		if err == nil {
			hub.SendToUser(invite.SenderID, acceptedMessage)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"groupId": groupID,
		})
	}
}
