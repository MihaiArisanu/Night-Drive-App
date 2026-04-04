package db

import (
	"database/sql"
	"time"
)

func StartChecksumWorker(dbConn *sql.DB) {
	ticker := time.NewTicker(1 * time.Minute)
	for range ticker.C {
		resetVotesQuery := `
			UPDATE events 
			SET upvotes = 0, downvotes = 0, last_reset_at = CURRENT_TIMESTAMP 
			WHERE CURRENT_TIMESTAMP - last_reset_at >= INTERVAL '1 hour' 
			AND CURRENT_TIMESTAMP - created_at <= INTERVAL '48 hours'
		`
		dbConn.Exec(resetVotesQuery)

		deleteExpiredQuery := `
			DELETE FROM events 
			WHERE CURRENT_TIMESTAMP - created_at > INTERVAL '48 hours'
		`
		dbConn.Exec(deleteExpiredQuery)
	}
}
