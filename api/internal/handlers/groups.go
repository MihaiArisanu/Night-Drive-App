package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/push"
	"github.com/MihaiArisanu/nightdrive-backend/internal/routing"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	maxGroupDestinationNameLength = 255
	groupStopProgressTolerance    = 150.0
	groupStopArrivalRadius        = 150.0
)

func UpdateGroupDestinationHandler(database *sql.DB, hub *ws.Hub) http.HandlerFunc {
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
		groupID := r.PathValue("id")
		if _, err := uuid.Parse(groupID); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_group_id", "Invalid group ID", nil)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var destination models.GroupDestination
		if err := decoder.Decode(&destination); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid destination", nil)
			return
		}
		destination.Name = strings.TrimSpace(destination.Name)
		if destination.Name == "" || utf8.RuneCountInString(destination.Name) > maxGroupDestinationNameLength {
			RespondWithError(w, http.StatusBadRequest, "invalid_destination_name", "Destination name must be between 1 and 255 characters", nil)
			return
		}
		if destination.Latitude < -90 || destination.Latitude > 90 ||
			destination.Longitude < -180 || destination.Longitude > 180 ||
			math.IsNaN(destination.Latitude) || math.IsNaN(destination.Longitude) ||
			math.IsInf(destination.Latitude, 0) || math.IsInf(destination.Longitude, 0) {
			RespondWithError(w, http.StatusBadRequest, "invalid_coordinates", "Invalid destination coordinates", nil)
			return
		}

		update, err := db.UpdateGroupDestination(r.Context(), database, groupID, userID, destination)
		if err != nil {
			switch {
			case errors.Is(err, db.ErrGroupNotFound):
				RespondWithError(w, http.StatusNotFound, "group_not_found", "Group not found", nil)
			case errors.Is(err, db.ErrGroupAccessDenied):
				RespondWithError(w, http.StatusForbidden, "group_access_denied", "You are not a member of this group", nil)
			case errors.Is(err, db.ErrGroupOwnerRequired):
				RespondWithError(w, http.StatusForbidden, "group_owner_required", "Only the group owner can change the final destination", nil)
			case errors.Is(err, db.ErrGroupNotActive):
				RespondWithError(w, http.StatusConflict, "group_not_active", "The final destination can be changed only after the group starts", nil)
			default:
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update the group destination", err)
			}
			return
		}

		message, err := json.Marshal(map[string]interface{}{
			"type":            "GROUP_DESTINATION_UPDATED",
			"targetGroupId":   groupID,
			"excludeSenderId": userID,
			"payload":         update,
		})
		if err == nil {
			hub.Broadcast <- message
		} else {
			log.Printf("Failed to marshal group destination update: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(update)
	}
}

func AddGroupStopHandler(database *sql.DB, rdb *redis.Client, hub *ws.Hub) http.HandlerFunc {
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
		_, status, memberIDs, _, err := db.GetRideGroupState(r.Context(), database, groupID, userID)
		if err != nil {
			respondWithGroupAccessError(w, err)
			return
		}
		if status != "active" {
			RespondWithError(w, http.StatusConflict, "group_not_active", "Stops can be added only to an active group", nil)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var req models.GroupStopRequest
		if err := decoder.Decode(&req); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
			return
		}
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" || utf8.RuneCountInString(req.Name) > maxGroupDestinationNameLength {
			RespondWithError(w, http.StatusBadRequest, "invalid_stop_name", "Stop name must be between 1 and 255 characters", nil)
			return
		}
		if !validCoordinates(req.Coordinates) {
			RespondWithError(w, http.StatusBadRequest, "invalid_coordinates", "Invalid stop coordinates", nil)
			return
		}

		skippedMembers := make(map[string]bool)
		for _, memberID := range memberIDs {
			ahead, reliable, reached := groupStopProgress(r.Context(), rdb, memberID, req.Coordinates)
			if reliable && !ahead && !reached {
				skippedMembers[memberID] = true
			}
		}

		result, err := db.CreateGroupStop(r.Context(), database, groupID, userID, models.GroupStop{
			Coordinates: req.Coordinates,
			Name:        req.Name,
		}, skippedMembers)
		if err != nil {
			switch {
			case errors.Is(err, db.ErrGroupNotFound):
				RespondWithError(w, http.StatusNotFound, "group_not_found", "Group not found", nil)
			case errors.Is(err, db.ErrGroupAccessDenied):
				RespondWithError(w, http.StatusForbidden, "group_access_denied", "You are not a member of this group", nil)
			case errors.Is(err, db.ErrGroupNotActive):
				RespondWithError(w, http.StatusConflict, "group_not_active", "Stops can be added only to an active group", nil)
			case errors.Is(err, db.ErrTooManyGroupStops):
				RespondWithError(w, http.StatusConflict, "too_many_group_stops", "Complete an existing group stop before adding another one", nil)
			default:
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to save group stop", err)
			}
			return
		}

		result.Update.AppliesToCurrentUser = containsString(result.EligibleMemberIDs, userID)
		liveUpdate := result.Update
		liveUpdate.AppliesToCurrentUser = true
		wsBytes, marshalErr := json.Marshal(map[string]interface{}{
			"type":    "GROUP_STOP_ADDED",
			"payload": liveUpdate,
		})
		if marshalErr == nil {
			for _, memberID := range result.EligibleMemberIDs {
				if memberID != userID {
					hub.SendToUser(memberID, wsBytes)
				}
			}
		} else {
			log.Printf("Failed to marshal group stop update: %v", marshalErr)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(result.Update)
	}
}

func EvaluateGroupStopsHandler(database *sql.DB, rdb *redis.Client) http.HandlerFunc {
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
		_, status, _, _, err := db.GetRideGroupState(r.Context(), database, groupID, userID)
		if err != nil {
			respondWithGroupAccessError(w, err)
			return
		}
		if status != "active" {
			RespondWithError(w, http.StatusConflict, "group_not_active", "Stop progress requires an active group", nil)
			return
		}

		stops, err := db.GetPendingGroupStopsForMember(r.Context(), database, groupID, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load group stops", err)
			return
		}
		resolvedStopIDs := make([]string, 0)
		// Stops are an ordered queue. Only the first pending stop may advance;
		// later stops can be geographically close to the current leg but must
		// remain pending until they become the driver's active stop.
		if len(stops) > 0 {
			stop := stops[0]
			ahead, reliable, reached := groupStopProgress(r.Context(), rdb, userID, stop.Coordinates)
			if reached || (reliable && !ahead) {
				if err := db.ResolveGroupStopForMember(r.Context(), database, stop.ID, userID, "completed"); err != nil {
					RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update stop progress", err)
					return
				}
				resolvedStopIDs = append(resolvedStopIDs, stop.ID)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string][]string{"resolvedStopIds": resolvedStopIDs})
	}
}

func CancelGroupStopHandler(database *sql.DB, hub *ws.Hub) http.HandlerFunc {
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
		groupID := r.PathValue("id")
		stopID := r.PathValue("stopId")
		if _, err := uuid.Parse(groupID); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_group_id", "Invalid group ID", nil)
			return
		}
		if _, err := uuid.Parse(stopID); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_stop_id", "Invalid stop ID", nil)
			return
		}

		result, err := db.CancelGroupStop(r.Context(), database, groupID, stopID, userID)
		if err != nil {
			switch {
			case errors.Is(err, db.ErrGroupNotFound), errors.Is(err, db.ErrGroupStopNotFound):
				RespondWithError(w, http.StatusNotFound, "group_stop_not_found", "Active group stop not found", nil)
			case errors.Is(err, db.ErrGroupAccessDenied):
				RespondWithError(w, http.StatusForbidden, "group_access_denied", "You are not a member of this group", nil)
			case errors.Is(err, db.ErrGroupNotActive):
				RespondWithError(w, http.StatusConflict, "group_not_active", "Stops can be cancelled only in an active group", nil)
			default:
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to cancel group stop", err)
			}
			return
		}

		if result.Cancellation.CancelledForAll {
			message, marshalErr := json.Marshal(map[string]interface{}{
				"type":    "GROUP_STOP_CANCELLED",
				"payload": result.Cancellation,
			})
			if marshalErr == nil {
				for _, memberID := range result.MemberIDs {
					if memberID != userID {
						hub.SendToUser(memberID, message)
					}
				}
			} else {
				log.Printf("Failed to marshal group stop cancellation: %v", marshalErr)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(result.Cancellation)
	}
}

func InviteGroupHandler(database *sql.DB, hub *ws.Hub, pushSender push.Sender) http.HandlerFunc {
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
		if err := db.CreateGroupInvite(r.Context(), database, invite); err != nil {
			switch {
			case errors.Is(err, db.ErrGroupMemberExists):
				RespondWithError(w, http.StatusConflict, "group_member_exists", "This driver is already in the group", nil)
			case errors.Is(err, db.ErrGroupInvitePending):
				RespondWithError(w, http.StatusConflict, "group_invite_pending", "This driver already has a pending group invite", nil)
			case errors.Is(err, db.ErrGroupAccessDenied):
				RespondWithError(w, http.StatusForbidden, "group_access_denied", "You are not a member of this group", nil)
			case errors.Is(err, db.ErrUserAlreadyInGroup):
				RespondWithError(w, http.StatusConflict, "already_in_another_group", "You are already in another ride group", nil)
			case errors.Is(err, db.ErrGroupClosed):
				RespondWithError(w, http.StatusConflict, "group_closed", "This ride group is already closed", nil)
			default:
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to persist group invite", err)
			}
			return
		}

		wsMessage := map[string]interface{}{
			"type": "GROUP_INVITE",
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
		sendPushAsync(pushSender, req.TargetUserId, push.Notification{
			Title: "Ride group invitation",
			Body:  invite.SenderName + " invited you to a ride group.",
			Type:  "GROUP_INVITE",
			Data: map[string]string{
				"inviteId":   invite.ID,
				"groupId":    invite.GroupID,
				"senderId":   invite.SenderID,
				"senderName": invite.SenderName,
			},
		})

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

func GetGroupDetailsHandler(database *sql.DB) http.HandlerFunc {
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

		details, err := loadGroupDetails(r.Context(), database, groupID, userID)
		if err != nil {
			respondWithGroupAccessError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(details)
	}
}

func GetCurrentGroupHandler(database *sql.DB) http.HandlerFunc {
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
		groupID, err := db.GetCurrentRideGroupID(r.Context(), database, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to restore the current group", err)
			return
		}
		if groupID == "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		details, err := loadGroupDetails(r.Context(), database, groupID, userID)
		if err != nil {
			respondWithGroupAccessError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(details)
	}
}

func GetGroupInvitesHandler(database *sql.DB) http.HandlerFunc {
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
		invites, err := db.GetGroupInvites(r.Context(), database, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load group invites", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(invites)
	}
}

func DeleteGroupInviteHandler(database *sql.DB) http.HandlerFunc {
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
		if err := db.DeleteGroupInvite(r.Context(), database, userID, inviteID); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to delete group invite", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func JoinGroupHandler(database *sql.DB, hub *ws.Hub) http.HandlerFunc {
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
		invite, err := db.AcceptGroupInvite(r.Context(), database, userID, groupID)
		if err != nil {
			if errors.Is(err, db.ErrUserAlreadyInGroup) {
				RespondWithError(w, http.StatusConflict, "already_in_another_group", "Leave your current group before joining another one", nil)
				return
			}
			if errors.Is(err, db.ErrGroupClosed) {
				RespondWithError(w, http.StatusConflict, "group_closed", "This ride group is already closed", nil)
				return
			}
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to accept group invite", err)
			return
		}
		if invite == nil {
			RespondWithError(w, http.StatusNotFound, "group_invite_not_found", "Group invite not found or expired", nil)
			return
		}
		details, detailsErr := loadGroupDetails(r.Context(), database, groupID, userID)
		if detailsErr != nil {
			log.Printf("Group invite accepted but the resulting snapshot could not be loaded: %v", detailsErr)
		}

		acceptedMessage, err := json.Marshal(map[string]interface{}{
			"type": "GROUP_INVITE_ACCEPTED",
			"payload": map[string]interface{}{
				"groupId":        groupID,
				"acceptedUserId": userID,
				"ownerId":        details.OwnerID,
				"version":        details.Version,
				"destination":    details.Destination,
			},
		})
		if err == nil {
			hub.SendToUser(invite.SenderID, acceptedMessage)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		response := map[string]interface{}{
			"success": true,
			"groupId": groupID,
		}
		if detailsErr == nil {
			response["ownerId"] = details.OwnerID
			response["status"] = details.Status
			response["version"] = details.Version
			response["destination"] = details.Destination
			response["stops"] = details.Stops
			response["members"] = details.Members
			response["pending"] = details.Pending
		}
		json.NewEncoder(w).Encode(response)
	}
}

func LeaveGroupHandler(database *sql.DB, hub *ws.Hub) http.HandlerFunc {
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
		groupID := r.PathValue("id")
		if _, err := uuid.Parse(groupID); err != nil {
			RespondWithError(w, http.StatusBadRequest, "invalid_group_id", "Invalid group ID", nil)
			return
		}

		result, err := db.LeaveRideGroup(r.Context(), database, groupID, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to leave group", err)
			return
		}
		// Reconnect with a new ticket so this socket immediately loses its former
		// group authorization, even if a custom client keeps the connection open.
		hub.DisconnectUser(userID)

		if !result.AlreadyAbsent {
			memberLeftMessage, marshalErr := json.Marshal(map[string]interface{}{
				"type": "GROUP_MEMBER_LEFT",
				"payload": map[string]interface{}{
					"groupId":    groupID,
					"userId":     userID,
					"dissolved":  result.Dissolved,
					"newOwnerId": result.NewOwnerID,
				},
			})
			if marshalErr == nil {
				for _, memberID := range result.RemainingMemberIDs {
					hub.SendToUser(memberID, memberLeftMessage)
				}
			}

			inviteCancelledMessage, marshalErr := json.Marshal(map[string]interface{}{
				"type": "GROUP_INVITE_CANCELLED",
				"payload": map[string]string{
					"groupId": groupID,
				},
			})
			if marshalErr == nil {
				for _, targetID := range result.CancelledInviteTargetIDs {
					hub.SendToUser(targetID, inviteCancelledMessage)
				}
			}
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func CloseGroupHandler(database *sql.DB, hub *ws.Hub) http.HandlerFunc {
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

		result, err := db.CloseRideGroup(r.Context(), database, groupID, userID)
		if err != nil {
			switch {
			case errors.Is(err, db.ErrGroupNotFound):
				RespondWithError(w, http.StatusNotFound, "group_not_found", "Group not found", nil)
			case errors.Is(err, db.ErrGroupOwnerRequired):
				RespondWithError(w, http.StatusForbidden, "group_owner_required", "Only the group owner can close the group", nil)
			default:
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to close group", err)
			}
			return
		}
		hub.DisconnectUser(userID)

		closedMessage, marshalErr := json.Marshal(map[string]interface{}{
			"type": "GROUP_CLOSED",
			"payload": map[string]string{
				"groupId":  groupID,
				"closedBy": userID,
			},
		})
		if marshalErr == nil {
			for _, memberID := range result.MemberIDs {
				if memberID != userID {
					hub.SendToUser(memberID, closedMessage)
				}
			}
		}

		cancelledMessage, marshalErr := json.Marshal(map[string]interface{}{
			"type":    "GROUP_INVITE_CANCELLED",
			"payload": map[string]string{"groupId": groupID},
		})
		if marshalErr == nil {
			for _, targetID := range result.CancelledInviteTargetIDs {
				hub.SendToUser(targetID, cancelledMessage)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func loadGroupDetails(ctx context.Context, database *sql.DB, groupID, userID string) (models.GroupDetails, error) {
	ownerID, status, memberIDs, pendingIDs, err := db.GetRideGroupState(ctx, database, groupID, userID)
	if err != nil {
		return models.GroupDetails{}, err
	}
	members, err := db.GetGroupParticipants(ctx, database, userID, memberIDs)
	if err != nil {
		return models.GroupDetails{}, fmt.Errorf("load group members: %w", err)
	}
	pending, err := db.GetGroupParticipants(ctx, database, userID, pendingIDs)
	if err != nil {
		return models.GroupDetails{}, fmt.Errorf("load pending group members: %w", err)
	}
	destination, version, err := db.GetGroupNavigationState(ctx, database, groupID)
	if err != nil {
		return models.GroupDetails{}, fmt.Errorf("load group navigation state: %w", err)
	}
	stops, err := db.GetPendingGroupStopsForMember(ctx, database, groupID, userID)
	if err != nil {
		return models.GroupDetails{}, fmt.Errorf("load group stops: %w", err)
	}
	return models.GroupDetails{
		ID:          groupID,
		OwnerID:     ownerID,
		Status:      status,
		Version:     version,
		Destination: destination,
		Stops:       stops,
		Members:     members,
		Pending:     pending,
	}, nil
}

func respondWithGroupAccessError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrGroupNotFound):
		RespondWithError(w, http.StatusNotFound, "group_not_found", "Group not found", nil)
	case errors.Is(err, db.ErrGroupAccessDenied):
		RespondWithError(w, http.StatusForbidden, "group_access_denied", "You are not a member of this group", nil)
	default:
		RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load group", err)
	}
}

func groupStopProgress(
	ctx context.Context,
	rdb *redis.Client,
	userID string,
	stop models.Coordinates,
) (ahead bool, reliable bool, reached bool) {
	location, err := db.GetLiveLocation(ctx, rdb, userID)
	if err != nil || time.Now().Unix()-location.Timestamp > int64(db.LiveLocationTTL.Seconds()) {
		return false, false, false
	}
	current := routing.Coordinate{
		Latitude:  location.Latitude,
		Longitude: location.Longitude,
	}
	target := routing.Coordinate{
		Latitude:  stop.Latitude,
		Longitude: stop.Longitude,
	}
	if routing.DistanceMeters(current, target) <= groupStopArrivalRadius {
		return true, true, true
	}

	encodedRoute, err := rdb.Get(ctx, "active_route:"+userID).Result()
	if err != nil || encodedRoute == "" {
		return false, false, false
	}
	route, err := routing.DecodePolyline(encodedRoute)
	if err != nil {
		return false, false, false
	}
	ahead, reliable = routing.IsPointAheadOnRoute(
		route,
		current,
		target,
		groupStopProgressTolerance,
	)
	return ahead, reliable, false
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
