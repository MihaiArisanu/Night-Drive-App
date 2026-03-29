package ws

import "encoding/json"

type Hub struct {
	Clients    map[*Client]bool
	Broadcast  chan []byte
	Register   chan *Client
	Unregister chan *Client
}

type RoutingInfo struct {
	TargetGroupId   string `json:"targetGroupId"`
	ExcludeSenderId string `json:"excludeSenderId"`
}

func NewHub() *Hub {
	return &Hub{
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Clients:    make(map[*Client]bool),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.Clients[client] = true
		case client := <-h.Unregister:
			if _, ok := h.Clients[client]; ok {
				delete(h.Clients, client)
				close(client.Send)
			}
		case message := <-h.Broadcast:
			var route RoutingInfo
			json.Unmarshal(message, &route)

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
		}
	}
}
