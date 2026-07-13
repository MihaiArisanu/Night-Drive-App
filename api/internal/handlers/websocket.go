package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
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

func CreateWebSocketTicketHandler(rdb *redis.Client) http.HandlerFunc {
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
		rateKey := "ws_ticket_rate:" + userID
		count, err := rdb.Incr(r.Context(), rateKey).Result()
		if err != nil {
			RespondWithError(w, http.StatusServiceUnavailable, "ticket_unavailable", "Could not create WebSocket ticket", err)
			return
		}
		if count == 1 {
			rdb.Expire(r.Context(), rateKey, time.Minute)
		}
		if count > 30 {
			RespondWithError(w, http.StatusTooManyRequests, "ticket_rate_limited", "Too many WebSocket connection attempts", nil)
			return
		}

		var request struct {
			GroupID string `json:"groupId"`
		}
		if r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
				RespondWithError(w, http.StatusBadRequest, "bad_request", "Invalid request body", nil)
				return
			}
		}

		authorizedGroupID := ""
		if request.GroupID != "" {
			if _, err := uuid.Parse(request.GroupID); err != nil {
				RespondWithError(w, http.StatusBadRequest, "invalid_group_id", "Invalid group ID", nil)
				return
			}
			_, status, _, _, err := db.GetRideGroupState(r.Context(), rdb, request.GroupID, userID)
			switch {
			case err == nil && status == "active":
				authorizedGroupID = request.GroupID
			case errors.Is(err, db.ErrGroupNotFound), errors.Is(err, db.ErrGroupAccessDenied):
				// A stale or forged group ID never becomes part of the ticket.
			case err != nil:
				RespondWithError(w, http.StatusServiceUnavailable, "group_validation_unavailable", "Could not validate group access", err)
				return
			}
		}

		ticket, err := db.CreateWebSocketTicket(r.Context(), rdb, userID, authorizedGroupID)
		if err != nil {
			RespondWithError(w, http.StatusServiceUnavailable, "ticket_unavailable", "Could not create WebSocket ticket", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ticket":    ticket,
			"expiresIn": int(db.WebSocketTicketTTL.Seconds()),
		})
	}
}

func ServeWS(hub *ws.Hub, rdb *redis.Client, w http.ResponseWriter, r *http.Request) {
	ticketValue := r.URL.Query().Get("ticket")
	if ticketValue == "" {
		RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
		return
	}
	ticket, err := db.ConsumeWebSocketTicket(r.Context(), rdb, ticketValue)
	if errors.Is(err, db.ErrInvalidWebSocketTicket) {
		RespondWithError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", nil)
		return
	}
	if err != nil {
		RespondWithError(w, http.StatusServiceUnavailable, "ticket_unavailable", "Authentication service unavailable", err)
		return
	}
	revoked, err := db.IsUserAccessRevoked(r.Context(), rdb, ticket.UserID)
	if err != nil {
		RespondWithError(w, http.StatusServiceUnavailable, "auth_unavailable", "Authentication service unavailable", err)
		return
	}
	if revoked {
		RespondWithError(w, http.StatusUnauthorized, "account_deleted", "Account no longer exists", nil)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	client := &ws.Client{
		Hub:     hub,
		Conn:    conn,
		Send:    make(chan []byte, 256),
		UserID:  ticket.UserID,
		GroupID: ticket.GroupID,
	}

	client.Hub.Register <- client

	go client.WritePump()
	go client.ReadPump()
}
