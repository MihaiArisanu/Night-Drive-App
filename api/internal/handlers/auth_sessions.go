package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const maxSessionClaimBodyBytes = 4 * 1024

func ClaimAuthSessionHandler(database *sql.DB, hub *ws.Hub, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxSessionClaimBodyBytes)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()

		var request struct {
			Challenge string `json:"challenge"`
		}
		if err := decoder.Decode(&request); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request payload", err)
			return
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Request must contain a single JSON object", err)
			return
		}
		request.Challenge = strings.TrimSpace(request.Challenge)
		if request.Challenge == "" {
			RespondWithError(w, http.StatusBadRequest, "validation_failed", "Session confirmation is required", nil)
			return
		}

		challenge, err := db.ConsumeLoginChallenge(r.Context(), rdb, request.Challenge)
		if errors.Is(err, db.ErrLoginChallengeExpired) {
			RespondWithError(w, http.StatusUnauthorized, "session_challenge_expired", "This confirmation expired. Please log in again", nil)
			return
		}
		if err != nil {
			RespondWithError(w, http.StatusServiceUnavailable, "auth_unavailable", "Could not validate session confirmation", err)
			return
		}

		user, err := db.GetUserByID(database, challenge.UserID)
		if err != nil {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Account no longer exists", nil)
			return
		}

		sessionID := uuid.NewString()
		accessToken, refreshToken, err := issueSessionTokens(user.ID, sessionID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not generate session tokens", err)
			return
		}

		previousSession, err := db.ClaimAuthSession(
			r.Context(),
			rdb,
			user.ID,
			challenge.ExpectedSessionID,
			db.AuthSession{
				SessionID: sessionID,
				DeviceID:  challenge.DeviceID,
				CreatedAt: time.Now().UTC(),
			},
			refreshToken,
		)
		if errors.Is(err, db.ErrAuthSessionChanged) {
			RespondWithError(w, http.StatusConflict, "session_conflict_changed", "The active session changed. Please log in again", nil)
			return
		}
		if err != nil {
			RespondWithError(w, http.StatusServiceUnavailable, "auth_unavailable", "Could not activate this device", err)
			return
		}

		if previousSession != nil && previousSession.SessionID != sessionID {
			message, marshalErr := json.Marshal(map[string]string{
				"type":            "session_invalidated",
				"message":         "Your account is now active on another device.",
				"targetUserId":    user.ID,
				"targetSessionId": previousSession.SessionID,
			})
			if marshalErr == nil {
				hub.Publish(message)
			}
		}

		writeSessionTokens(w, accessToken, refreshToken, user.ID)
	}
}
