package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/handlers"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
)

func main() {
	database, err := db.Connect()
	if err != nil {
		log.Fatalf("Server startup failed: %v", err)
	}
	defer database.Close()

	go db.StartCleanupWorker(database)

	hub := ws.NewHub()
	go hub.Run()

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "NightDrive API is running smoothly!")
	})
	mux.HandleFunc("/api/users", handlers.CreateUserHandler(database))
	mux.HandleFunc("/api/login", handlers.LoginHandler(database))
	mux.HandleFunc("/api/events/nearby", handlers.GetNearbyEventsHandler(database))
	mux.HandleFunc("/api/users/search", handlers.RequireAuth(handlers.SearchUserHandler(database)))
	mux.HandleFunc("/api/events", handlers.RequireAuth(handlers.CreateEventHandler(database, hub)))
	mux.HandleFunc("/api/events/vote", handlers.RequireAuth(handlers.VoteEventHandler(database)))
	mux.HandleFunc("/api/friends/nearby", handlers.RequireAuth(handlers.GetNearbyFriendsHandler(database)))
	mux.HandleFunc("/api/voice/upload", handlers.RequireAuth(handlers.UploadVoiceHandler(hub)))
	mux.HandleFunc("/api/users/places", handlers.RequireAuth(handlers.PlacesHandler(database)))

	mux.HandleFunc("/api/ws", func(w http.ResponseWriter, r *http.Request) {
		handlers.ServeWS(hub, w, r)
	})

	port := ":8080"
	log.Printf("Starting backend server on http://192.168.100.225%s\n", port)

	handlerWithCORS := handlers.CORSMiddleware(mux)

	handlerWithLogging := handlers.LoggingMiddleware(handlerWithCORS)

	err = http.ListenAndServe(port, handlerWithLogging)
	if err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
