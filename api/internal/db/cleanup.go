package db

import (
	"database/sql"
	"log"
	"time"
)

func StartCleanupWorker(dbConn *sql.DB) {
	ticker := time.NewTicker(1 * time.Hour)

	go func() {
		for range ticker.C {
			query := `DELETE FROM events WHERE expires_at < NOW()`
			result, err := dbConn.Exec(query)

			if err != nil {
				log.Printf("Cleanup Worker Error: %v", err)
				continue
			}

			rowsAffected, _ := result.RowsAffected()
			if rowsAffected > 0 {
				log.Printf("Cleanup Worker: Deleted %d expired events", rowsAffected)
			}
		}
	}()
}
