package handlers

import (
	"context"
	"log"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/push"
)

func sendPushAsync(sender push.Sender, userID string, notification push.Notification) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if err := sender.SendToUser(ctx, userID, notification); err != nil {
			log.Printf("[WARN] Push notification %s for user %s failed: %v", notification.Type, userID, err)
		}
	}()
}
