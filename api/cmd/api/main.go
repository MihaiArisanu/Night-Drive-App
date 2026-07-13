package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/handlers"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	database, err := db.Connect()
	if err != nil {
		log.Fatalf("Server startup failed: %v", err)
	}
	defer func() {
		log.Println("Closing database connection...")
		database.Close()
	}()

	if err := handlers.InitJWTSecret(); err != nil {
		log.Fatalf("Failed to initialize JWT secret: %v", err)
	}

	go db.StartMaintenanceWorker(ctx, database)
	go handlers.StartVoiceRetentionWorker(ctx, 24*time.Hour)

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "localhost:6379"
	}
	rdb := db.NewRedisClient(redisURL)
	defer func() {
		log.Println("Closing Redis client...")
		rdb.Close()
	}()
	if err := db.DeleteLegacyLocationIndex(ctx, rdb); err != nil {
		log.Printf("Failed to remove legacy location index: %v", err)
	}

	minioClient, err := db.NewMinioClient()
	if err != nil {
		log.Fatalf("Failed to initialize MinIO: %v", err)
	}

	hub := ws.NewHub(rdb)
	go hub.Run()

	mux := http.NewServeMux()

	mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("./uploads"))))

	mux.HandleFunc("/api/v1", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"app":     "NightDrive API",
			"version": "v1.0",
			"status":  "online",
			"message": "Engine is running.",
		})
	})

	mux.HandleFunc("/api/v1/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/" {
			handlers.RespondWithError(w, http.StatusNotFound, "not_found", "Route not found", nil)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"app":     "NightDrive API",
			"version": "v1.0",
			"status":  "online",
			"message": "Engine is running. Drive safe! 🚗💨",
		})
	})

	strictRateLimit := handlers.RateLimit(rdb, 5, time.Minute)
	requireAuth := func(next http.HandlerFunc) http.HandlerFunc {
		return handlers.RequireAuth(rdb, next)
	}
	mux.HandleFunc("/api/v1/login", strictRateLimit(handlers.LoginHandler(database, hub, rdb)))
	mux.HandleFunc("/api/v1/users", strictRateLimit(handlers.CreateUserHandler(database)))
	mux.HandleFunc("/api/v1/auth/refresh", strictRateLimit(handlers.RefreshTokenHandler(database, rdb)))
	mux.HandleFunc("/api/v1/auth/logout", strictRateLimit(requireAuth(handlers.LogoutHandler(rdb))))
	mux.HandleFunc("/api/v1/auth/ws-ticket", requireAuth(handlers.CreateWebSocketTicketHandler(rdb)))
	mux.HandleFunc("/api/v1/auth/forgot-password", strictRateLimit(handlers.ForgotPasswordHandler(database)))
	mux.HandleFunc("/api/v1/events/nearby", handlers.GetNearbyEventsHandler(database))
	mux.HandleFunc("/api/v1/users/search", requireAuth(handlers.SearchUserHandler(database)))
	mux.HandleFunc("/api/v1/users/me", requireAuth(handlers.GetUserMeHandler(database, rdb, minioClient, hub)))
	mux.HandleFunc("/api/v1/users/profile", requireAuth(handlers.UpdateUserProfileHandler(database)))
	mux.HandleFunc("/api/v1/users/password", requireAuth(handlers.ChangePasswordHandler(database)))
	mux.HandleFunc("/api/v1/users/feedback", requireAuth(handlers.SubmitFeedbackHandler(database)))

	mux.HandleFunc("/api/v1/users/location", requireAuth(handlers.UpdateUserLocationHandler(rdb)))
	mux.HandleFunc("/api/v1/events", requireAuth(handlers.CreateEventHandler(database, hub)))

	mux.HandleFunc("/api/v1/events/vote", requireAuth(handlers.VoteEventHandler(database)))
	mux.HandleFunc("/api/v1/friends", requireAuth(handlers.GetAllFriendsHandler(database)))
	mux.HandleFunc("/api/v1/friends/nearby", requireAuth(handlers.GetNearbyFriendsHandler(database, rdb)))
	mux.HandleFunc("/api/v1/friends/request", requireAuth(handlers.SendFriendRequestHandler(database)))
	mux.HandleFunc("/api/v1/friends/requests", requireAuth(handlers.GetFriendRequestsHandler(database)))
	mux.HandleFunc("/api/v1/friends/requests/{id}/respond", requireAuth(handlers.RespondFriendRequestHandler(database)))

	mux.HandleFunc("/api/v1/users/places", requireAuth(handlers.PlacesHandler(database)))
	mux.HandleFunc("/api/v1/users/places/{id}", requireAuth(handlers.PlaceByIDHandler(database)))
	mux.HandleFunc("/api/v1/users/dislikes", requireAuth(handlers.DislikesHandler(database)))
	mux.HandleFunc("/api/v1/users/dislikes/{id}", requireAuth(handlers.DislikeByIDHandler(database)))

	mux.HandleFunc("/api/v1/locations/history", requireAuth(handlers.LocationHistoryHandler(database)))

	mux.HandleFunc("/api/v1/routes/zen/start", requireAuth(handlers.StartZenModeHandler(rdb)))
	mux.HandleFunc("/api/v1/routes/zen/stop", requireAuth(handlers.StopZenModeHandler(rdb)))
	mux.HandleFunc("/api/v1/routes/zen/sync", requireAuth(handlers.SyncZenLocationHandler(rdb)))

	mux.HandleFunc("/api/v1/users/fcm", requireAuth(handlers.UpdateFCMTokenHandler(database)))

	mux.HandleFunc("/api/v1/groups/{id}/stop", requireAuth(handlers.AddGroupStopHandler(database, hub)))
	mux.HandleFunc("/api/v1/groups/invite", requireAuth(handlers.InviteGroupHandler(database, hub, rdb)))
	mux.HandleFunc("/api/v1/group-invites", requireAuth(handlers.GetGroupInvitesHandler(rdb)))
	mux.HandleFunc("/api/v1/group-invites/{id}", requireAuth(handlers.DeleteGroupInviteHandler(rdb)))
	mux.HandleFunc("/api/v1/groups/{id}/join", requireAuth(handlers.JoinGroupHandler(rdb, hub)))
	mux.HandleFunc("/api/v1/groups/{id}/members/me", requireAuth(handlers.LeaveGroupHandler(rdb, hub)))
	mux.HandleFunc("/api/v1/groups/{id}/voice-token", requireAuth(handlers.GroupVoiceTokenHandler(database, rdb)))
	mux.HandleFunc("/api/v1/groups/{id}", requireAuth(handlers.GetGroupDetailsHandler(database, rdb)))

	mux.HandleFunc("/api/v1/ws", func(w http.ResponseWriter, r *http.Request) {
		handlers.ServeWS(hub, rdb, w, r)
	})

	mux.HandleFunc("/api/v1/users/avatar", requireAuth(handlers.UploadAvatarHandler(database, minioClient)))
	mux.HandleFunc("/api/v1/avatars/{filename}", handlers.ServeAvatarHandler(minioClient))
	// Compatibility for clients that cached the former MinIO-style /avatars URL.
	mux.HandleFunc("/avatars/{filename}", handlers.ServeAvatarHandler(minioClient))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	host := os.Getenv("HOST")
	addr := fmt.Sprintf("%s:%s", host, port)

	handlerWithCORS := handlers.CORSMiddleware(mux)
	handlerWithLogging := handlers.LoggingMiddleware(handlerWithCORS)

	srv := &http.Server{
		Addr:         addr,
		Handler:      handlerWithLogging,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("Starting backend server on %s\n", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server forced to shutdown due to error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down gracefully... Press Ctrl+C again to force exit.")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Server forced to shutdown violently: %v", err)
	}

	log.Println("Backend server stopped cleanly.")
}
