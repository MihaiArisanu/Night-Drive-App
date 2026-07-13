package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
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
	invites, err := GetGroupInvites(ctx, rdb, userID)
	if err != nil {
		return err
	}
	for _, invite := range invites {
		if err := DeleteGroupInvite(ctx, rdb, userID, invite.ID); err != nil {
			return err
		}
	}

	iterator := rdb.Scan(ctx, 0, "ride_group:*:members", 100).Iterator()
	for iterator.Next(ctx) {
		key := iterator.Val()
		groupID := strings.TrimSuffix(strings.TrimPrefix(key, "ride_group:"), ":members")
		if groupID == "" || groupID == key {
			continue
		}
		isMember, err := rdb.SIsMember(ctx, key, userID).Result()
		if err != nil {
			return fmt.Errorf("check ride group during account deletion: %w", err)
		}
		if isMember {
			if _, err := LeaveRideGroup(ctx, rdb, groupID, userID); err != nil {
				return err
			}
		}
	}
	if err := iterator.Err(); err != nil {
		return fmt.Errorf("scan ride groups during account deletion: %w", err)
	}

	keys := []string{
		"refresh_token:" + userID,
		"live_loc:" + userID,
		"zen_session:" + userID,
		"active_route:" + userID,
		groupInvitesKey(userID),
	}
	if err := rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("delete user Redis data: %w", err)
	}
	return nil
}
