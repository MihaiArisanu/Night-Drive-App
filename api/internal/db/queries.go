package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

func UpdateFCMToken(ctx context.Context, dbConn *sql.DB, userID string, token string) error {
	tx, err := dbConn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin FCM token update: %w", err)
	}
	defer tx.Rollback()

	normalizedToken := strings.TrimSpace(token)
	if normalizedToken != "" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE users
			SET fcm_token = NULL
			WHERE fcm_token = $1 AND id <> $2
		`, normalizedToken, userID); err != nil {
			return fmt.Errorf("detach FCM token from previous account: %w", err)
		}
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE users
		SET fcm_token = NULLIF($1, '')
		WHERE id = $2
	`, normalizedToken, userID)
	if err != nil {
		return fmt.Errorf("store FCM token: %w", err)
	}
	if rowsAffected, err := result.RowsAffected(); err != nil || rowsAffected != 1 {
		return fmt.Errorf("FCM token user not found")
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit FCM token update: %w", err)
	}
	return nil
}

func GetFCMToken(ctx context.Context, dbConn *sql.DB, userID string) (string, error) {
	var token sql.NullString
	if err := dbConn.QueryRowContext(ctx, `
		SELECT fcm_token FROM users WHERE id = $1
	`, userID).Scan(&token); err != nil {
		return "", fmt.Errorf("load FCM token: %w", err)
	}
	return token.String, nil
}

func ClearFCMTokenIfMatches(ctx context.Context, dbConn *sql.DB, userID, token string) error {
	if _, err := dbConn.ExecContext(ctx, `
		UPDATE users
		SET fcm_token = NULL
		WHERE id = $1 AND fcm_token = $2
	`, userID, token); err != nil {
		return fmt.Errorf("clear stale FCM token: %w", err)
	}
	return nil
}
