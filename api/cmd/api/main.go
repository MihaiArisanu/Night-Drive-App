package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/handlers"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
)

func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

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

	mux.HandleFunc("/api/events", handlers.RequireAuth(handlers.CreateEventHandler(database, hub)))
	mux.HandleFunc("/api/events/vote", handlers.RequireAuth(handlers.VoteEventHandler(database)))

	mux.HandleFunc("/api/ws", func(w http.ResponseWriter, r *http.Request) {
		handlers.ServeWS(hub, w, r)
	})

	port := ":8080"
	log.Printf("Starting backend server on http://192.168.100.225%s\n", port)

	err = http.ListenAndServe(port, enableCORS(mux))
	if err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
