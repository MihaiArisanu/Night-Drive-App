package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

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
	go db.StartChecksumWorker(database)

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "localhost:6379"
	}
	rdb := db.NewRedisClient(redisURL)

	hub := ws.NewHub(rdb)
	go hub.Run()

	mux := http.NewServeMux()

	mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("./uploads"))))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprintf(w, `{"error": "Route not found", "path": "%s"}`, r.URL.Path)
	})

	authRateLimit := handlers.RateLimit(rdb, 5, time.Minute)

	mux.HandleFunc("/api/v1/users", authRateLimit(handlers.CreateUserHandler(database)))
	mux.HandleFunc("/api/v1/login", authRateLimit(handlers.LoginHandler(database, hub, rdb)))
	mux.HandleFunc("/api/v1/auth/refresh", authRateLimit(handlers.RefreshTokenHandler(database, rdb)))
	mux.HandleFunc("/api/v1/auth/logout", authRateLimit(handlers.RequireAuth(handlers.LogoutHandler(rdb))))
	mux.HandleFunc("/api/v1/auth/forgot-password", authRateLimit(handlers.ForgotPasswordHandler(database)))
	mux.HandleFunc("/api/v1/events/nearby", handlers.GetNearbyEventsHandler(database))
	mux.HandleFunc("/api/v1/users/search", handlers.RequireAuth(handlers.SearchUserHandler(database)))
	mux.HandleFunc("/api/v1/users/me", handlers.RequireAuth(handlers.GetUserMeHandler(database)))
	mux.HandleFunc("/api/v1/users/feedback", handlers.RequireAuth(handlers.SubmitFeedbackHandler(database)))
	mux.HandleFunc("/api/v1/users/location", handlers.RequireAuth(handlers.UpdateUserLocationHandler(database)))

	mux.HandleFunc("/api/v1/events", handlers.RequireAuth(handlers.CreateEventHandler(database, hub)))

	mux.HandleFunc("/api/v1/events/vote", handlers.RequireAuth(handlers.VoteEventHandler(database)))
	mux.HandleFunc("/api/v1/friends", handlers.RequireAuth(handlers.GetAllFriendsHandler(database)))
	mux.HandleFunc("/api/v1/friends/nearby", handlers.RequireAuth(handlers.GetNearbyFriendsHandler(database)))
	mux.HandleFunc("/api/v1/friends/request", handlers.RequireAuth(handlers.SendFriendRequestHandler(database)))
	mux.HandleFunc("/api/v1/friends/requests", handlers.RequireAuth(handlers.GetFriendRequestsHandler(database)))
	mux.HandleFunc("/api/v1/friends/requests/{id}/respond", handlers.RequireAuth(handlers.RespondFriendRequestHandler(database)))

	mux.HandleFunc("/api/v1/voice/upload", handlers.RequireAuth(handlers.UploadVoiceHandler(hub)))
	mux.HandleFunc("/api/v1/users/places", handlers.RequireAuth(handlers.PlacesHandler(database)))
	mux.HandleFunc("/api/v1/users/places/{id}", handlers.RequireAuth(handlers.PlaceByIDHandler(database)))
	mux.HandleFunc("/api/v1/users/dislikes", handlers.RequireAuth(handlers.DislikesHandler(database)))
	mux.HandleFunc("/api/v1/users/dislikes/{id}", handlers.RequireAuth(handlers.DislikeByIDHandler(database)))

	mux.HandleFunc("/api/v1/locations/history", handlers.RequireAuth(handlers.LocationHistoryHandler(database)))

	mux.HandleFunc("/api/v1/routes/zen/start", handlers.RequireAuth(handlers.StartZenModeHandler(rdb)))
	mux.HandleFunc("/api/v1/routes/zen/stop", handlers.RequireAuth(handlers.StopZenModeHandler(rdb)))
	mux.HandleFunc("/api/v1/routes/zen/sync", handlers.RequireAuth(handlers.SyncZenLocationHandler(rdb)))

	mux.HandleFunc("/api/v1/users/fcm", handlers.RequireAuth(handlers.UpdateFCMTokenHandler(database)))

	mux.HandleFunc("/api/v1/groups/{id}/stop", handlers.RequireAuth(handlers.AddGroupStopHandler(database, hub)))
	mux.HandleFunc("/api/v1/groups/invite", handlers.RequireAuth(handlers.InviteGroupHandler(hub)))
	mux.HandleFunc("/api/v1/groups/{id}/join", handlers.RequireAuth(handlers.JoinGroupHandler()))

	mux.HandleFunc("/api/v1/ws", func(w http.ResponseWriter, r *http.Request) {
		handlers.ServeWS(hub, w, r)
	})

	mux.HandleFunc("/api/v1/users/avatar", handlers.RequireAuth(handlers.UploadAvatarHandler(database)))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	host := os.Getenv("HOST")
	addr := fmt.Sprintf("%s:%s", host, port)

	log.Printf("Starting backend server on %s\n", addr)

	handlerWithCORS := handlers.CORSMiddleware(mux)

	handlerWithLogging := handlers.LoggingMiddleware(handlerWithCORS)

	err = http.ListenAndServe(addr, handlerWithLogging)
	if err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
