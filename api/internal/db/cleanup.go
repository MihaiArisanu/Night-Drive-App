package db

import (
	"context"
	"database/sql"
	"log"
	"time"
)

func StartMaintenanceWorker(ctx context.Context, dbConn *sql.DB) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Maintenance Worker shutting down...")
			return
		case <-ticker.C:
			resetVotesQuery := `
				UPDATE events 
				SET upvotes = 0, downvotes = 0, last_reset_at = CURRENT_TIMESTAMP 
				WHERE CURRENT_TIMESTAMP - last_reset_at >= INTERVAL '1 hour' 
				AND CURRENT_TIMESTAMP - created_at <= INTERVAL '48 hours'
			`
			if _, err := dbConn.ExecContext(ctx, resetVotesQuery); err != nil {
				log.Printf("[Worker] Error resetting votes: %v", err)
			}

			deleteExpiredQuery := `
				DELETE FROM events 
				WHERE expires_at < NOW() 
				   OR CURRENT_TIMESTAMP - created_at > INTERVAL '48 hours'
			`
			result, err := dbConn.ExecContext(ctx, deleteExpiredQuery)
			if err != nil {
				log.Printf("[Worker] Error deleting expired events: %v", err)
				continue
			}

			if rowsAffected, _ := result.RowsAffected(); rowsAffected > 0 {
				log.Printf("[Worker] Cleared %d old/expired events", rowsAffected)
			}
		}
	}
}
