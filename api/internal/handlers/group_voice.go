package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/google/uuid"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
)

const voiceTokenTTL = 10 * time.Minute

func GroupVoiceTokenHandler(database *sql.DB) http.HandlerFunc {
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
			switch {
			case errors.Is(err, db.ErrGroupNotFound):
				RespondWithError(w, http.StatusNotFound, "group_not_found", "Group not found or expired", nil)
			case errors.Is(err, db.ErrGroupAccessDenied):
				RespondWithError(w, http.StatusForbidden, "group_access_denied", "You are not a member of this group", nil)
			default:
				RespondWithError(w, http.StatusServiceUnavailable, "voice_unavailable", "Could not validate voice access", err)
			}
			return
		}
		if status != "active" {
			RespondWithError(w, http.StatusConflict, "group_not_active", "Voice is available only in an active group", nil)
			return
		}

		apiKey := os.Getenv("LIVEKIT_API_KEY")
		apiSecret := os.Getenv("LIVEKIT_API_SECRET")
		serverURL := os.Getenv("LIVEKIT_PUBLIC_URL")
		if apiKey == "" || apiSecret == "" || serverURL == "" {
			RespondWithError(w, http.StatusServiceUnavailable, "voice_not_configured", "Group voice is not configured", nil)
			return
		}
		user, err := db.GetUserByID(database, userID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "user_not_found", "User not found", nil)
			return
		}

		grant := &auth.VideoGrant{
			RoomJoin: true,
			Room:     "ride-" + groupID,
		}
		grant.SetCanPublish(true)
		grant.SetCanSubscribe(true)
		grant.SetCanPublishData(false)
		grant.SetCanPublishSources([]livekit.TrackSource{livekit.TrackSource_MICROPHONE})

		participantToken, err := auth.NewAccessToken(apiKey, apiSecret).
			SetIdentity(userID).
			SetName(user.Username).
			SetValidFor(voiceTokenTTL).
			SetVideoGrant(grant).
			ToJWT()
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "voice_token_failed", "Could not create voice token", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"serverUrl":        serverURL,
			"participantToken": participantToken,
			"expiresIn":        int(voiceTokenTTL.Seconds()),
		})
	}
}
