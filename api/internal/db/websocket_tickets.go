package db

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const WebSocketTicketTTL = 30 * time.Second

var ErrInvalidWebSocketTicket = errors.New("invalid or expired WebSocket ticket")

type WebSocketTicket struct {
	UserID  string `json:"userId"`
	GroupID string `json:"groupId,omitempty"`
}

func webSocketTicketKey(ticket string) string {
	digest := sha256.Sum256([]byte(ticket))
	return "ws_ticket:" + hex.EncodeToString(digest[:])
}

func CreateWebSocketTicket(ctx context.Context, rdb *redis.Client, userID, groupID string) (string, error) {
	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("generate WebSocket ticket: %w", err)
	}
	ticket := base64.RawURLEncoding.EncodeToString(randomBytes)
	payload, err := json.Marshal(WebSocketTicket{UserID: userID, GroupID: groupID})
	if err != nil {
		return "", fmt.Errorf("encode WebSocket ticket: %w", err)
	}
	if err := rdb.Set(ctx, webSocketTicketKey(ticket), payload, WebSocketTicketTTL).Err(); err != nil {
		return "", fmt.Errorf("store WebSocket ticket: %w", err)
	}
	return ticket, nil
}

func ConsumeWebSocketTicket(ctx context.Context, rdb *redis.Client, ticket string) (WebSocketTicket, error) {
	payload, err := rdb.GetDel(ctx, webSocketTicketKey(ticket)).Bytes()
	if errors.Is(err, redis.Nil) {
		return WebSocketTicket{}, ErrInvalidWebSocketTicket
	}
	if err != nil {
		return WebSocketTicket{}, fmt.Errorf("consume WebSocket ticket: %w", err)
	}

	var result WebSocketTicket
	if err := json.Unmarshal(payload, &result); err != nil || result.UserID == "" {
		return WebSocketTicket{}, ErrInvalidWebSocketTicket
	}
	return result, nil
}
