package handlers

import (
	"log"
	"net/http"

	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func ServeWS(hub *ws.Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	client := &ws.Client{Hub: hub, Conn: conn, Send: make(chan []byte, 256)}
	client.Hub.Register <- client

	go client.WritePump()
	go client.ReadPump()
}
