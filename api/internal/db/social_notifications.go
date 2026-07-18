package db

import (
	"context"
	"database/sql"
	"fmt"
)

type SocialNotificationCount struct {
	Total          int `json:"total"`
	FriendRequests int `json:"friendRequests"`
	GroupInvites   int `json:"groupInvites"`
}

func GetSocialNotificationCount(ctx context.Context, database *sql.DB, userID string) (SocialNotificationCount, error) {
	var count SocialNotificationCount
	err := database.QueryRowContext(ctx, `
		SELECT
			(SELECT COUNT(*)
			 FROM friend_requests
			 WHERE receiver_id = $1 AND status = 'pending') AS friend_requests,
			(SELECT COUNT(*)
			 FROM ride_group_invites invitation
			 JOIN ride_groups ride_group ON ride_group.id = invitation.group_id
			 WHERE invitation.target_user_id = $1
			   AND invitation.status = 'pending'
			   AND invitation.expires_at > CURRENT_TIMESTAMP
			   AND ride_group.status <> 'closed') AS group_invites
	`, userID).Scan(&count.FriendRequests, &count.GroupInvites)
	if err != nil {
		return SocialNotificationCount{}, fmt.Errorf("count social notifications: %w", err)
	}
	count.Total = count.FriendRequests + count.GroupInvites
	return count, nil
}
