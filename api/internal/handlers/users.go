package handlers

import (
	"context"

	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
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

func GetJWTKey() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		log.Fatal("JWT_SECRET environment variable is required")
	}
	return []byte(secret)
}

func LoginHandler(database *sql.DB, hub *ws.Hub, rdb *redis.Client) http.HandlerFunc {
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

		kickMsg := map[string]string{
			"type":    "session_invalidated",
			"message": "Te-ai logat de pe alt dispozitiv.",
		}
		kickBytes, _ := json.Marshal(kickMsg)

		hub.SendToUser(user.ID, kickBytes)

		jwtKey := GetJWTKey()

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": user.ID,
			"exp":     time.Now().Add(72 * time.Hour).Unix(),
		})
		tokenString, err := token.SignedString(jwtKey)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not generate token", nil)
			return
		}

		refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": user.ID,
			"type":    "refresh",
			"exp":     time.Now().Add(30 * 24 * time.Hour).Unix(),
		})
		refreshTokenString, err := refreshToken.SignedString(jwtKey)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not generate refresh token", err)
			return
		}

		ctx := context.Background()
		if err := rdb.Set(ctx, "refresh_token:"+user.ID, refreshTokenString, 30*24*time.Hour).Err(); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not save refresh token", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"access_token":  tokenString,
			"refresh_token": refreshTokenString,
			"user_id":       user.ID,
		})
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
		})

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

		ctx := context.Background()
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

		newAccessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": user.ID,
			"exp":     time.Now().Add(72 * time.Hour).Unix(),
		})
		newAccessTokenString, err := newAccessToken.SignedString(jwtKey)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not generate new access token", nil)
			return
		}

		newRefreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": user.ID,
			"type":    "refresh",
			"exp":     time.Now().Add(30 * 24 * time.Hour).Unix(),
		})
		newRefreshTokenString, err := newRefreshToken.SignedString(jwtKey)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not generate new refresh token", err)
			return
		}

		if err := rdb.Set(ctx, "refresh_token:"+userID, newRefreshTokenString, 30*24*time.Hour).Err(); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Could not save new refresh token", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"access_token":  newAccessTokenString,
			"refresh_token": newRefreshTokenString,
		})
	}
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

func GetNearbyFriendsHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed", nil)
			return
		}

		latStr := r.URL.Query().Get("lat")
		lngStr := r.URL.Query().Get("lng")

		lat, errLat := strconv.ParseFloat(latStr, 64)
		lng, errLng := strconv.ParseFloat(lngStr, 64)

		if errLat != nil || errLng != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid or missing lat/lng parameters", nil)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
			return
		}

		nearbyUsers, err := db.GetNearbyActiveUsers(database, lat, lng, userID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to fetch nearby friends", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(nearbyUsers)
	}
}

func GetUserMeHandler(database *sql.DB) http.HandlerFunc {
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

		user, err := db.GetUserByID(database, userID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "api_error", "User not found", nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":    user.ID,
			"name":  user.Username,
			"tag":   user.Tag,
			"email": user.Email,
		})
	}
}

func UpdateUserLocationHandler(database *sql.DB) http.HandlerFunc {
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
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
			Heading   float64 `json:"heading"`
			Speed     float64 `json:"speed"`
			IsDnd     bool    `json:"isDnd"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
			return
		}

		if err := db.UpdateUserLocation(database, userID, payload.Latitude, payload.Longitude, payload.Heading, payload.Speed, payload.IsDnd); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update location", nil)
			return
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

		ctx := context.Background()
		rdb.Del(ctx, "refresh_token:"+userID)

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

		if err := db.UpdateUserPassword(database, user.ID, string(hashedPassword)); err != nil {
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to update password", err)
			return
		}

		emailBody := "Hello " + user.Username + ",\n\nYour new temporary password is: " + newPassword + "\n\nPlease login and change it as soon as possible."
		if err := utils.SendEmail(user.Email, "NightDrive Password Reset", emailBody); err != nil {
			log.Printf("Failed to send email to %s: %v", user.Email, err)
			RespondWithError(w, http.StatusInternalServerError, "api_error", "Failed to send email", err)
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
