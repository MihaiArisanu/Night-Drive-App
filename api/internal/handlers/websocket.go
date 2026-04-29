package handlers

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}

		allowedOrigins := os.Getenv("ALLOWED_ORIGINS")
		if allowedOrigins != "" {
			for _, o := range strings.Split(allowedOrigins, ",") {
				if strings.TrimSpace(o) == origin {
					return true
				}
			}
			return false
		}

		return true
	},
}

func ServeWS(hub *ws.Hub, w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
		return
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
		return
	}
	tokenString := parts[1]

	jwtKey := GetJWTKey()

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return jwtKey, nil
	})

	if err != nil || !token.Valid {
		RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
		return
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
		return
	}

	userID := claims["user_id"].(string)
	groupID := r.URL.Query().Get("groupId")

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	client := &ws.Client{
		Hub:     hub,
		Conn:    conn,
		Send:    make(chan []byte, 256),
		UserID:  userID,
		GroupID: groupID,
	}

	client.Hub.Register <- client

	go client.WritePump()
	go client.ReadPump()
}
