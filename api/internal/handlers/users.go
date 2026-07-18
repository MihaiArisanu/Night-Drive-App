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
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-playground/validator/v10"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/spontaneous"
	"github.com/MihaiArisanu/nightdrive-backend/internal/utils"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
)

func CreateUserHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		var req models.UserCreateRequest
		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request payload", err)
			return
		}

		if err := validate.Struct(req); err != nil {
			RespondWithError(w, http.StatusBadRequest, "validation_failed", "Input validation failed: "+err.Error(), nil)
			return
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to secure password", nil)
			return
		}

		newUser := models.User{
			Username:     req.Username,
			Tag:          req.Tag,
			Email:        req.Email,
			PasswordHash: string(hashedPassword),
		}

		err = db.CreateUser(database, &newUser)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to create user in database", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(newUser)
	}
}

var jwtSecret []byte

func InitJWTSecret() error {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return errors.New("JWT_SECRET environment variable is required")
	}
	jwtSecret = []byte(secret)
	return nil
}

func GetJWTKey() []byte {
	return jwtSecret
}

func LoginHandler(database *sql.DB, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		var creds models.LoginRequest
		if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request", err)
			return
		}

		if err := validate.Struct(creds); err != nil {
			RespondWithError(w, http.StatusBadRequest, "validation_failed", "Input validation failed: "+err.Error(), nil)
			return
		}

		user, err := db.GetUserByEmail(database, creds.Email)
		if err != nil {
			RespondWithError(w, http.StatusUnauthorized, "bad_request", "Invalid credentials", nil)
			return
		}

		err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(creds.Password))
		if err != nil {
			RespondWithError(w, http.StatusUnauthorized, "bad_request", "Invalid credentials", nil)
			return
		}

		deviceID := strings.TrimSpace(creds.DeviceID)
		if deviceID == "" {
			// Older clients do not provide a stable device identifier. Giving
			// every login a unique value keeps the single-session guarantee,
			// although those clients will see the confirmation on every login.
			deviceID = "legacy-login:" + uuid.NewString()
		}

		sessionID := uuid.NewString()
		accessToken, refreshToken, err := issueSessionTokens(user.ID, sessionID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not generate session tokens", err)
			return
		}

		started, activeSession, err := db.StartAuthSession(
			r.Context(),
			rdb,
			user.ID,
			db.AuthSession{
				SessionID: sessionID,
				DeviceID:  deviceID,
				CreatedAt: time.Now().UTC(),
			},
			refreshToken,
		)
		if err != nil {
			RespondWithError(w, http.StatusServiceUnavailable, "auth_unavailable", "Could not start login session", err)
			return
		}
		if !started {
			if activeSession == nil {
				RespondWithError(w, http.StatusConflict, "session_conflict", "This account is already active on another device", nil)
				return
			}
			challenge, err := db.CreateLoginChallenge(r.Context(), rdb, db.LoginChallenge{
				UserID:            user.ID,
				DeviceID:          deviceID,
				ExpectedSessionID: activeSession.SessionID,
			})
			if err != nil {
				RespondWithError(w, http.StatusServiceUnavailable, "auth_unavailable", "Could not prepare session confirmation", err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":      "session_conflict",
				"message":    "This account is already active on another device",
				"challenge":  challenge,
				"expires_in": int(db.LoginChallengeTTL.Seconds()),
			})
			return
		}

		writeSessionTokens(w, accessToken, refreshToken, user.ID)
	}
}

func RefreshTokenHandler(database *sql.DB, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		var req struct {
			RefreshToken string `json:"refresh_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request payload", nil)
			return
		}

		jwtKey := GetJWTKey()

		claims := jwt.MapClaims{}
		token, err := jwt.ParseWithClaims(req.RefreshToken, claims, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))

		if err != nil || !token.Valid {
			RespondWithError(w, http.StatusUnauthorized, "bad_request", "Invalid or expired refresh token", nil)
			return
		}

		if claims["type"] != "refresh" {
			RespondWithError(w, http.StatusUnauthorized, "bad_request", "Invalid token type", nil)
			return
		}

		userID, ok := claims["user_id"].(string)
		if !ok {
			RespondWithError(w, http.StatusUnauthorized, "bad_request", "Invalid token claims", nil)
			return
		}

		ctx := r.Context()
		sessionID, _ := claims["sid"].(string)
		activeSession, err := db.GetAuthSession(ctx, rdb, userID)
		if err != nil {
			RespondWithError(w, http.StatusServiceUnavailable, "auth_unavailable", "Authentication service unavailable", err)
			return
		}
		if sessionID == "" {
			if activeSession != nil {
				sessionID = activeSession.SessionID
			} else {
				sessionID = uuid.NewString()
			}
		}
		if activeSession != nil && activeSession.SessionID != sessionID {
			RespondWithError(w, http.StatusUnauthorized, "session_replaced", "This account is active on another device", nil)
			return
		}

		storedToken, err := rdb.Get(ctx, "refresh_token:"+userID).Result()
		if err != nil || storedToken != req.RefreshToken {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Invalid or expired refresh token", nil)
			return
		}

		user, err := db.GetUserByID(database, userID)
		if err != nil {
			RespondWithError(w, http.StatusUnauthorized, "api_error", "User not found", nil)
			return
		}

		newAccessToken, newRefreshToken, err := issueSessionTokens(user.ID, sessionID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not generate new session tokens", err)
			return
		}

		if activeSession == nil {
			started, _, err := db.StartAuthSession(ctx, rdb, user.ID, db.AuthSession{
				SessionID: sessionID,
				DeviceID:  "legacy-refresh",
				CreatedAt: time.Now().UTC(),
			}, newRefreshToken)
			if err != nil {
				RespondWithError(w, http.StatusServiceUnavailable, "auth_unavailable", "Could not recover login session", err)
				return
			}
			if !started {
				RespondWithError(w, http.StatusUnauthorized, "session_replaced", "This account is active on another device", nil)
				return
			}
		} else {
			rotated, err := db.RotateSessionRefreshToken(ctx, rdb, user.ID, sessionID, newRefreshToken)
			if err != nil {
				RespondWithError(w, http.StatusServiceUnavailable, "auth_unavailable", "Could not refresh login session", err)
				return
			}
			if !rotated {
				RespondWithError(w, http.StatusUnauthorized, "session_replaced", "This account is active on another device", nil)
				return
			}
		}

		writeSessionTokens(w, newAccessToken, newRefreshToken, user.ID)
	}
}

func issueSessionTokens(userID, sessionID string) (string, string, error) {
	now := time.Now().UTC()
	jwtKey := GetJWTKey()
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"sid":     sessionID,
		"iat":     now.Unix(),
		"exp":     now.Add(72 * time.Hour).Unix(),
	})
	accessTokenString, err := accessToken.SignedString(jwtKey)
	if err != nil {
		return "", "", fmt.Errorf("sign access token: %w", err)
	}
	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"sid":     sessionID,
		"type":    "refresh",
		"iat":     now.Unix(),
		"exp":     now.Add(db.AuthSessionTTL).Unix(),
	})
	refreshTokenString, err := refreshToken.SignedString(jwtKey)
	if err != nil {
		return "", "", fmt.Errorf("sign refresh token: %w", err)
	}
	return accessTokenString, refreshTokenString, nil
}

func writeSessionTokens(w http.ResponseWriter, accessToken, refreshToken, userID string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]string{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"user_id":       userID,
	})
}

func SearchUserHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		tag := r.URL.Query().Get("tag")
		if tag == "" || len(tag) < 4 {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid or missing tag", nil)
			return
		}

		user, err := db.SearchUserByTag(database, tag)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Server error during search", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		if user == nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"message": "No driver found with this tag"})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(user)
	}
}

const maxFriendLocationDistanceMeters = 50_000

func GetNearbyFriendsHandler(database *sql.DB, rdb *redis.Client) http.HandlerFunc {
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

		requesterLocation, err := db.GetLiveLocation(r.Context(), rdb, userID)
		if errors.Is(err, db.ErrLiveLocationNotFound) {
			respondWithNearbyUsers(w, []models.NearbyUser{})
			return
		}
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load your live location", err)
			return
		}
		if !isFreshLiveLocation(requesterLocation, time.Now()) {
			respondWithNearbyUsers(w, []models.NearbyUser{})
			return
		}

		friendProfiles, err := db.GetFriendsForLocationSharing(r.Context(), database, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load friends", err)
			return
		}

		groupMemberIDs := make(map[string]bool)
		profileExists := make(map[string]bool, len(friendProfiles))
		for _, friend := range friendProfiles {
			profileExists[friend.ID] = true
		}

		groupID := r.URL.Query().Get("groupId")
		if groupID != "" {
			if _, err := uuid.Parse(groupID); err != nil {
				RespondWithError(w, http.StatusBadRequest, "invalid_group_id", "Invalid group ID", nil)
				return
			}

			_, status, memberIDs, _, groupErr := db.GetRideGroupState(r.Context(), database, groupID, userID)
			switch {
			case groupErr == nil && status == "active":
				otherMemberIDs := make([]string, 0, len(memberIDs))
				for _, memberID := range memberIDs {
					if memberID == userID {
						continue
					}
					groupMemberIDs[memberID] = true
					if !profileExists[memberID] {
						otherMemberIDs = append(otherMemberIDs, memberID)
					}
				}
				groupProfiles, err := db.GetLocationProfiles(r.Context(), database, otherMemberIDs)
				if err != nil {
					RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load group members", err)
					return
				}
				friendProfiles = append(friendProfiles, groupProfiles...)
			case errors.Is(groupErr, db.ErrGroupNotFound), errors.Is(groupErr, db.ErrGroupAccessDenied):
				// A stale client-side group ID never grants access to group locations.
			case groupErr != nil:
				RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to validate group membership", groupErr)
				return
			}
		}

		friendIDs := make([]string, len(friendProfiles))
		for index, friend := range friendProfiles {
			friendIDs[index] = friend.ID
		}
		liveLocations, err := db.GetLiveLocations(r.Context(), rdb, friendIDs)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to load live locations", err)
			return
		}

		now := time.Now()
		nearbyUsers := make([]models.NearbyUser, 0, len(friendProfiles))
		for _, friend := range friendProfiles {
			location, exists := liveLocations[friend.ID]
			if !exists || !isFreshLiveLocation(location, now) {
				continue
			}
			if location.IsDND && !groupMemberIDs[friend.ID] {
				continue
			}
			if distanceMeters(requesterLocation.Coordinates, location.Coordinates) > maxFriendLocationDistanceMeters {
				continue
			}
			nearbyUsers = append(nearbyUsers, models.NearbyUser{
				ID:                friend.ID,
				Name:              friend.Name,
				ProfilePictureURL: friend.ProfilePictureURL,
				Coordinates:       location.Coordinates,
				Heading:           location.Heading,
			})
		}

		respondWithNearbyUsers(w, nearbyUsers)
	}
}

func respondWithNearbyUsers(w http.ResponseWriter, users []models.NearbyUser) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(users)
}

func isFreshLiveLocation(location models.LiveLocation, now time.Time) bool {
	oldestAllowed := now.Add(-db.LiveLocationTTL).Unix()
	return location.Timestamp >= oldestAllowed && location.Timestamp <= now.Add(5*time.Second).Unix()
}

func distanceMeters(from, to models.Coordinates) float64 {
	const earthRadiusMeters = 6_371_000
	toRadians := func(degrees float64) float64 { return degrees * math.Pi / 180 }

	lat1 := toRadians(from.Latitude)
	lat2 := toRadians(to.Latitude)
	deltaLat := toRadians(to.Latitude - from.Latitude)
	deltaLng := toRadians(to.Longitude - from.Longitude)
	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(deltaLng/2)*math.Sin(deltaLng/2)
	a = math.Max(0, math.Min(1, a))
	return earthRadiusMeters * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func GetUserMeHandler(database *sql.DB, rdb *redis.Client, minioClient *minio.Client, hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodDelete {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}
		if r.Method == http.MethodDelete {
			deleteUserAccount(w, r, database, rdb, minioClient, hub, userID)
			return
		}

		user, err := db.GetUserByID(database, userID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "api_error", "User not found", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":                  user.ID,
			"name":                user.Username,
			"tag":                 user.Tag,
			"email":               user.Email,
			"profile_picture_url": user.ProfilePictureURL,
		})
	}
}

func deleteUserAccount(
	w http.ResponseWriter,
	r *http.Request,
	database *sql.DB,
	rdb *redis.Client,
	minioClient *minio.Client,
	hub *ws.Hub,
	userID string,
) {
	ctx := r.Context()
	if err := db.RevokeUserAccess(ctx, rdb, userID); err != nil {
		RespondWithError(w, http.StatusServiceUnavailable, "deletion_unavailable", "Account deletion is temporarily unavailable", err)
		return
	}

	if err := db.DeleteUserRedisData(ctx, rdb, userID); err != nil {
		db.RestoreUserAccess(context.Background(), rdb, userID)
		RespondWithError(w, http.StatusServiceUnavailable, "deletion_unavailable", "Could not clear active account data", err)
		return
	}

	avatarURL, _, err := db.DeleteUserAccount(ctx, database, userID)
	if err != nil {
		db.RestoreUserAccess(context.Background(), rdb, userID)
		RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not delete account", err)
		return
	}

	hub.DisconnectUser(userID)
	if objectName, ok := avatarObjectName(avatarURL); ok {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := minioClient.RemoveObject(cleanupCtx, avatarBucketName, objectName, minio.RemoveObjectOptions{}); err != nil {
			log.Printf("[WARN] Could not delete avatar for removed account %s: %v", userID, err)
		}
	}
	if err := deleteUserVoiceFiles(userID); err != nil {
		log.Printf("[WARN] Could not delete voice files for removed account %s: %v", userID, err)
	}

	w.WriteHeader(http.StatusNoContent)
}

func UpdateUserLocationHandler(rdb *redis.Client, spontaneousRides *spontaneous.Service) http.HandlerFunc {
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

		var payload struct {
			Latitude   float64                `json:"latitude"`
			Longitude  float64                `json:"longitude"`
			Heading    float64                `json:"heading"`
			Speed      float64                `json:"speed"`
			Accuracy   float64                `json:"accuracy"`
			IsDnd      bool                   `json:"isDnd"`
			Navigation *models.LiveNavigation `json:"navigation,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
			return
		}

		if payload.Latitude < -90 || payload.Latitude > 90 || payload.Longitude < -180 || payload.Longitude > 180 {
			RespondWithError(w, http.StatusBadRequest, "invalid_coordinates", "Invalid latitude or longitude", nil)
			return
		}
		if payload.Accuracy < 0 || math.IsNaN(payload.Accuracy) || math.IsInf(payload.Accuracy, 0) {
			RespondWithError(w, http.StatusBadRequest, "invalid_accuracy", "Invalid location accuracy", nil)
			return
		}
		if payload.Navigation != nil {
			if payload.Navigation.Mode != "none" && payload.Navigation.Mode != "destination" && payload.Navigation.Mode != "zen" {
				RespondWithError(w, http.StatusBadRequest, "invalid_navigation", "Invalid navigation state", nil)
				return
			}
			if payload.Navigation.Mode == "destination" {
				if payload.Navigation.Destination == nil || !validCoordinates(*payload.Navigation.Destination) {
					RespondWithError(w, http.StatusBadRequest, "invalid_navigation", "Destination coordinates are required", nil)
					return
				}
			} else {
				payload.Navigation.Destination = nil
			}
		}

		location := models.LiveLocation{
			Coordinates: models.Coordinates{
				Latitude:  payload.Latitude,
				Longitude: payload.Longitude,
			},
			Heading:    payload.Heading,
			Speed:      payload.Speed,
			Accuracy:   payload.Accuracy,
			IsDND:      payload.IsDnd,
			Navigation: payload.Navigation,
			Timestamp:  time.Now().Unix(),
		}
		if err := db.SaveLiveLocation(r.Context(), rdb, userID, location); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update live location", nil)
			return
		}
		if spontaneousRides != nil {
			go spontaneousRides.HandleLocationUpdate(userID, location)
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

var validate = validator.New()

func LogoutHandler(rdb *redis.Client) http.HandlerFunc {
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
		sessionID, ok := r.Context().Value(SessionIDKey).(string)
		if !ok || sessionID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		if _, err := db.EndAuthSession(r.Context(), rdb, userID, sessionID); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to end session", err)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func ForgotPasswordHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request payload", err)
			return
		}

		user, err := db.GetUserByEmail(database, req.Email)
		if err != nil {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"message": "If the email exists, a new password has been sent."})
			return
		}

		newPassword, err := utils.GenerateRandomPassword(10)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to generate password", err)
			return
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to secure password", err)
			return
		}

		emailBody := "Hello " + user.Username + ",\n\nYour new temporary password is: " + newPassword + "\n\nPlease login and change it as soon as possible."
		if err := utils.SendEmail(user.Email, "NightDrive Password Reset", emailBody); err != nil {
			log.Printf("Failed to send email to %s: %v", user.Email, err)
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to send email. Password was not changed.", err)
			return
		}

		if err := db.UpdateUserPassword(database, user.ID, string(hashedPassword)); err != nil {
			log.Printf("Failed to update password in DB for %s: %v", user.Email, err)
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update password", err)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "If the email exists, a new password has been sent."})
	}
}

func SubmitFeedbackHandler(database *sql.DB) http.HandlerFunc {
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

		var req struct {
			Message string `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request payload", err)
			return
		}

		if req.Message == "" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Feedback message cannot be empty", nil)
			return
		}

		user, err := db.GetUserByID(database, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to retrieve user data", err)
			return
		}

		adminEmail := os.Getenv("SMTP_USER")
		if adminEmail == "" {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Admin email not configured", nil)
			return
		}

		subject := "NightDrive Feedback from " + user.Username + " (#" + user.Tag + ")"
		body := "User: " + user.Username + " (#" + user.Tag + ")\nEmail: " + user.Email + "\n\nFeedback:\n" + req.Message

		if err := utils.SendEmail(adminEmail, subject, body); err != nil {
			log.Printf("Failed to send feedback email: %v", err)
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to send feedback", err)
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "Feedback sent successfully."})
	}
}

func UpdateUserProfileHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		var payload struct {
			Name  string `json:"name"`
			Email string `json:"email"`
		}

		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
			return
		}

		if payload.Name == "" || payload.Email == "" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Name and email cannot be empty", nil)
			return
		}

		err := db.UpdateUserProfile(database, userID, payload.Name, payload.Email)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update profile", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	}
}

func ChangePasswordHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		var payload struct {
			OldPassword string `json:"old_password"`
			NewPassword string `json:"new_password"`
		}

		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
			return
		}

		if payload.OldPassword == "" || payload.NewPassword == "" {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Passwords cannot be empty", nil)
			return
		}
		if utf8.RuneCountInString(payload.NewPassword) < 8 {
			RespondWithError(w, http.StatusBadRequest, "password_too_short", "New password must contain at least 8 characters", nil)
			return
		}
		if len([]byte(payload.NewPassword)) > 72 {
			RespondWithError(w, http.StatusBadRequest, "password_too_long", "New password is too long", nil)
			return
		}

		user, err := db.GetUserByID(database, userID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "not_found", "User not found", nil)
			return
		}

		err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(payload.OldPassword))
		if err != nil {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Incorrect old password", nil)
			return
		}
		if payload.OldPassword == payload.NewPassword {
			RespondWithError(w, http.StatusConflict, "password_unchanged", "New password must be different from the old password", nil)
			return
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(payload.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to hash password", nil)
			return
		}

		err = db.UpdateUserPassword(database, userID, string(hashedPassword))
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update password", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	}
}
