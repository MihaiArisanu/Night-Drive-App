package ws

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/redis/go-redis/v9"
)

type Hub struct {
	Clients    map[*Client]bool
	Users      map[string]*Client
	Broadcast  chan []byte
	Register   chan *Client
	Unregister chan *Client
	Rdb        *redis.Client
	mu         sync.RWMutex
}

type RoutingInfo struct {
	Type            string `json:"type"`
	TargetGroupId   string `json:"targetGroupId"`
	TargetUserId    string `json:"targetUserId"`
	TargetSessionId string `json:"targetSessionId"`
	ExcludeSenderId string `json:"excludeSenderId"`
}

func NewHub(rdb *redis.Client) *Hub {
	return &Hub{
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Clients:    make(map[*Client]bool),
		Users:      make(map[string]*Client),
		Rdb:        rdb,
	}
}

func (h *Hub) Publish(message []byte) {
	h.Rdb.Publish(context.Background(), "ws_broadcast", message)
}

func (h *Hub) Run() {
	ctx := context.Background()
	pubsub := h.Rdb.Subscribe(ctx, "ws_broadcast")
	ch := pubsub.Channel()

	go func() {
		for msg := range ch {
			h.Broadcast <- []byte(msg.Payload)
		}
	}()

	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			if previous, exists := h.Users[client.UserID]; exists && previous != client {
				delete(h.Clients, previous)
				close(previous.Send)
			}
			h.Clients[client] = true
			h.Users[client.UserID] = client
			h.mu.Unlock()

		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.Clients[client]; ok {
				delete(h.Clients, client)
				if h.Users[client.UserID] == client {
					delete(h.Users, client.UserID)
				}
				close(client.Send)
			}
			h.mu.Unlock()

		case message := <-h.Broadcast:
			var route RoutingInfo
			json.Unmarshal(message, &route)

			h.mu.Lock()
			for client := range h.Clients {
				if route.TargetGroupId != "" && client.GroupID != route.TargetGroupId {
					continue
				}
				if route.TargetUserId != "" && client.UserID != route.TargetUserId {
					continue
				}
				if route.TargetSessionId != "" && client.SessionID != route.TargetSessionId {
					continue
				}
				if route.ExcludeSenderId != "" && client.UserID == route.ExcludeSenderId {
					continue
				}

				select {
				case client.Send <- message:
					if route.Type == "session_invalidated" {
						close(client.Send)
						delete(h.Clients, client)
						if h.Users[client.UserID] == client {
							delete(h.Users, client.UserID)
						}
					}
				default:
					close(client.Send)
					delete(h.Clients, client)
					if h.Users[client.UserID] == client {
						delete(h.Users, client.UserID)
					}
				}
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) SendToUser(userID string, message []byte) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	client, ok := h.Users[userID]
	if !ok {
		return false
	}

	select {
	case client.Send <- message:
		return true
	default:
		close(client.Send)
		delete(h.Clients, client)
		if h.Users[userID] == client {
			delete(h.Users, userID)
		}
		return false
	}
}

func (h *Hub) DisconnectUser(userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	client, ok := h.Users[userID]
	if !ok {
		return
	}
	delete(h.Users, userID)
	delete(h.Clients, client)
	close(client.Send)
}
