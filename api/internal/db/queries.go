package db

import (
	"context"
	"database/sql"
)

func UpdateFCMToken(ctx context.Context, dbConn *sql.DB, userID string, token string) error {
	_, err := dbConn.ExecContext(ctx, "UPDATE users SET fcm_token = $1 WHERE id = $2", token, userID)
	return err
}
