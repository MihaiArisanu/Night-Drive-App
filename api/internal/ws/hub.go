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
			h.Clients[client] = true
			h.Users[client.UserID] = client
			h.mu.Unlock()

		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.Clients[client]; ok {
				delete(h.Clients, client)
				delete(h.Users, client.UserID)
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
				if route.ExcludeSenderId != "" && client.UserID == route.ExcludeSenderId {
					continue
				}

				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.Clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) SendToUser(userID string, message []byte) {
	h.mu.RLock()
	client, ok := h.Users[userID]
	h.mu.RUnlock()

	if ok {
		select {
		case client.Send <- message:
		default:
			h.mu.Lock()
			close(client.Send)
			delete(h.Clients, client)
			delete(h.Users, userID)
			h.mu.Unlock()
		}
	}
}
