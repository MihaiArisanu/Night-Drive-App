package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
)

func CreateUserHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req models.UserCreateRequest
		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			http.Error(w, "Invalid request payload", http.StatusBadRequest)
			return
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			http.Error(w, "Failed to secure password", http.StatusInternalServerError)
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
			http.Error(w, "Failed to create user in database", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(newUser)
	}
}

var jwtKey = []byte("super_secret_jwt_key_for_nightdrive")

func LoginHandler(database *sql.DB, hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var creds models.LoginRequest
		if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		user, err := db.GetUserByEmail(database, creds.Email)
		if err != nil {
			http.Error(w, "Invalid credentials", http.StatusUnauthorized)
			return
		}

		err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(creds.Password))
		if err != nil {
			http.Error(w, "Invalid credentials", http.StatusUnauthorized)
			return
		}

		// Trimitem mesajul de deconectare vechii sesiuni
		kickMsg := map[string]string{
			"type":    "session_invalidated",
			"message": "Te-ai logat de pe alt dispozitiv.",
		}
		kickBytes, _ := json.Marshal(kickMsg)

		// Asta va căuta în memoria serverului dacă userul e conectat pe alt telefon
		// și îi va trimite eventul pe WebSocket.
		hub.SendToUser(user.ID, kickBytes)

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": user.ID,
			"exp":     time.Now().Add(72 * time.Hour).Unix(),
		})
		tokenString, err := token.SignedString(jwtKey)
		if err != nil {
			http.Error(w, "Could not generate token", http.StatusInternalServerError)
			return
		}

		refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": user.ID,
			"type":    "refresh",
			"exp":     time.Now().Add(30 * 24 * time.Hour).Unix(),
		})
		refreshTokenString, err := refreshToken.SignedString(jwtKey)
		if err != nil {
			http.Error(w, "Could not generate refresh token", http.StatusInternalServerError)
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

func RefreshTokenHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			RefreshToken string `json:"refresh_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request payload", http.StatusBadRequest)
			return
		}

		claims := jwt.MapClaims{}
		token, err := jwt.ParseWithClaims(req.RefreshToken, claims, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		})

		if err != nil || !token.Valid {
			http.Error(w, "Invalid or expired refresh token", http.StatusUnauthorized)
			return
		}

		if claims["type"] != "refresh" {
			http.Error(w, "Invalid token type", http.StatusUnauthorized)
			return
		}

		userID, ok := claims["user_id"].(string)
		if !ok {
			http.Error(w, "Invalid token claims", http.StatusUnauthorized)
			return
		}

		// Optionally verify if user still exists
		user, err := db.GetUserByID(database, userID)
		if err != nil {
			http.Error(w, "User not found", http.StatusUnauthorized)
			return
		}

		newAccessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": user.ID,
			"exp":     time.Now().Add(72 * time.Hour).Unix(),
		})
		newAccessTokenString, err := newAccessToken.SignedString(jwtKey)
		if err != nil {
			http.Error(w, "Could not generate new access token", http.StatusInternalServerError)
			return
		}

		newRefreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": user.ID,
			"type":    "refresh",
			"exp":     time.Now().Add(30 * 24 * time.Hour).Unix(),
		})
		newRefreshTokenString, err := newRefreshToken.SignedString(jwtKey)
		if err != nil {
			http.Error(w, "Could not generate new refresh token", http.StatusInternalServerError)
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
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		tag := r.URL.Query().Get("tag")
		if tag == "" || len(tag) < 4 {
			http.Error(w, "Invalid or missing tag", http.StatusBadRequest)
			return
		}

		user, err := db.SearchUserByTag(database, tag)
		if err != nil {
			http.Error(w, "Server error during search", http.StatusInternalServerError)
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
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		latStr := r.URL.Query().Get("lat")
		lngStr := r.URL.Query().Get("lng")

		lat, errLat := strconv.ParseFloat(latStr, 64)
		lng, errLng := strconv.ParseFloat(lngStr, 64)

		if errLat != nil || errLng != nil {
			http.Error(w, "Invalid or missing lat/lng parameters", http.StatusBadRequest)
			return
		}

		nearbyUsers, err := db.GetNearbyActiveUsers(database, lat, lng)
		if err != nil {
			http.Error(w, "Failed to fetch nearby friends", http.StatusInternalServerError)
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
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		user, err := db.GetUserByID(database, userID)
		if err != nil {
			http.Error(w, "User not found", http.StatusNotFound)
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
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID, ok := r.Context().Value(UserIDKey).(string)
		if !ok || userID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
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
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if err := db.UpdateUserLocation(database, userID, payload.Latitude, payload.Longitude, payload.Heading, payload.Speed, payload.IsDnd); err != nil {
			http.Error(w, "Failed to update location", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
