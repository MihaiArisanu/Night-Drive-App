package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const revokedUserTTL = 73 * time.Hour

func revokedUserKey(userID string) string {
	return "revoked_user:" + userID
}

func RevokeUserAccess(ctx context.Context, rdb *redis.Client, userID string) error {
	if err := rdb.Set(ctx, revokedUserKey(userID), "1", revokedUserTTL).Err(); err != nil {
		return fmt.Errorf("revoke user access: %w", err)
	}
	return nil
}

func RestoreUserAccess(ctx context.Context, rdb *redis.Client, userID string) error {
	if err := rdb.Del(ctx, revokedUserKey(userID)).Err(); err != nil {
		return fmt.Errorf("restore user access: %w", err)
	}
	return nil
}

func IsUserAccessRevoked(ctx context.Context, rdb *redis.Client, userID string) (bool, error) {
	exists, err := rdb.Exists(ctx, revokedUserKey(userID)).Result()
	if err != nil {
		return false, fmt.Errorf("check revoked user: %w", err)
	}
	return exists > 0, nil
}

func DeleteUserAccount(ctx context.Context, database *sql.DB, userID string) (string, bool, error) {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return "", false, fmt.Errorf("begin account deletion: %w", err)
	}
	defer tx.Rollback()
	if err := LeaveRideGroupsForAccountDeletion(ctx, tx, userID); err != nil {
		return "", false, fmt.Errorf("leave ride groups: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `UPDATE group_stops SET added_by = NULL WHERE added_by = $1`, userID); err != nil {
		return "", false, fmt.Errorf("detach group stops: %w", err)
	}

	var avatarURL string
	err = tx.QueryRowContext(ctx, `
		DELETE FROM users
		WHERE id = $1
		RETURNING COALESCE(profile_picture_url, '')
	`, userID).Scan(&avatarURL)
	if errors.Is(err, sql.ErrNoRows) {
		if err := tx.Commit(); err != nil {
			return "", false, fmt.Errorf("commit empty account deletion: %w", err)
		}
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("delete user account: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", false, fmt.Errorf("commit account deletion: %w", err)
	}
	return avatarURL, true, nil
}

func DeleteUserRedisData(ctx context.Context, rdb *redis.Client, userID string) error {
	keys := []string{
		"refresh_token:" + userID,
		"live_loc:" + userID,
		"zen_session:" + userID,
		"active_route:" + userID,
	}
	if err := rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("delete user Redis data: %w", err)
	}
	return nil
}
