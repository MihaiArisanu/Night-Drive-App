package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/redis/go-redis/v9"
)

const groupInviteTTL = 24 * time.Hour

var (
	ErrGroupMemberExists  = errors.New("user is already a group member")
	ErrGroupInvitePending = errors.New("user already has a pending group invite")
	ErrGroupAccessDenied  = errors.New("user is not allowed to manage this group")
	ErrGroupNotFound      = errors.New("group not found")
)

func groupInvitesKey(userID string) string {
	return "group_invites:" + userID
}

func groupMetaKey(groupID string) string    { return "ride_group:" + groupID + ":meta" }
func groupMembersKey(groupID string) string { return "ride_group:" + groupID + ":members" }
func groupPendingKey(groupID string) string { return "ride_group:" + groupID + ":pending" }

var createGroupInviteScript = redis.NewScript(`
local meta = KEYS[1]
local members = KEYS[2]
local pending = KEYS[3]
local user_invites = KEYS[4]

local sender_id = ARGV[1]
local target_id = ARGV[2]
local invite_id = ARGV[3]
local invite_payload = ARGV[4]
local created_at = ARGV[5]
local ttl_seconds = tonumber(ARGV[6])

if redis.call('EXISTS', meta) == 0 then
  redis.call('HSET', meta, 'owner_id', sender_id, 'status', 'draft', 'created_at', created_at)
  redis.call('SADD', members, sender_id)
end

if redis.call('SISMEMBER', members, sender_id) == 0 then
  return 'access_denied'
end
if redis.call('SISMEMBER', members, target_id) == 1 then
  return 'already_member'
end
if redis.call('HEXISTS', pending, target_id) == 1 then
  return 'already_pending'
end

redis.call('HSET', pending, target_id, invite_id)
redis.call('HSET', user_invites, invite_id, invite_payload)
redis.call('EXPIRE', meta, ttl_seconds)
redis.call('EXPIRE', members, ttl_seconds)
redis.call('EXPIRE', pending, ttl_seconds)
redis.call('EXPIRE', user_invites, ttl_seconds)
return 'created'
`)

func CreateGroupInvite(ctx context.Context, rdb *redis.Client, invite models.GroupInvite) error {
	payload, err := json.Marshal(invite)
	if err != nil {
		return fmt.Errorf("encode group invite: %w", err)
	}

	result, err := createGroupInviteScript.Run(ctx, rdb, []string{
		groupMetaKey(invite.GroupID),
		groupMembersKey(invite.GroupID),
		groupPendingKey(invite.GroupID),
		groupInvitesKey(invite.TargetUserID),
	}, invite.SenderID, invite.TargetUserID, invite.ID, payload, invite.CreatedAt.Format(time.RFC3339), int(groupInviteTTL.Seconds())).Text()
	if err != nil {
		return fmt.Errorf("create group invite: %w", err)
	}

	switch result {
	case "created":
		return nil
	case "already_member":
		return ErrGroupMemberExists
	case "already_pending":
		return ErrGroupInvitePending
	case "access_denied":
		return ErrGroupAccessDenied
	default:
		return fmt.Errorf("unexpected group invite result: %s", result)
	}
}

func GetGroupInvites(ctx context.Context, rdb *redis.Client, userID string) ([]models.GroupInvite, error) {
	values, err := rdb.HGetAll(ctx, groupInvitesKey(userID)).Result()
	if err != nil {
		return nil, fmt.Errorf("load group invites: %w", err)
	}

	invites := make([]models.GroupInvite, 0, len(values))
	for _, value := range values {
		var invite models.GroupInvite
		if err := json.Unmarshal([]byte(value), &invite); err != nil {
			continue
		}
		invites = append(invites, invite)
	}
	sort.Slice(invites, func(i, j int) bool {
		return invites[i].CreatedAt.After(invites[j].CreatedAt)
	})
	return invites, nil
}

func DeleteGroupInvite(ctx context.Context, rdb *redis.Client, userID, inviteID string) error {
	payload, err := rdb.HGet(ctx, groupInvitesKey(userID), inviteID).Result()
	if errors.Is(err, redis.Nil) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load group invite for deletion: %w", err)
	}
	var invite models.GroupInvite
	if err := json.Unmarshal([]byte(payload), &invite); err != nil {
		return fmt.Errorf("decode group invite for deletion: %w", err)
	}

	pipe := rdb.TxPipeline()
	pipe.HDel(ctx, groupInvitesKey(userID), inviteID)
	pipe.HDel(ctx, groupPendingKey(invite.GroupID), userID)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("delete group invite: %w", err)
	}
	return nil
}

func AcceptGroupInvite(ctx context.Context, rdb *redis.Client, userID, groupID string) (*models.GroupInvite, error) {
	invites, err := GetGroupInvites(ctx, rdb, userID)
	if err != nil {
		return nil, err
	}

	inviteIDs := make([]string, 0, 1)
	var acceptedInvite *models.GroupInvite
	for _, invite := range invites {
		if invite.GroupID == groupID {
			inviteIDs = append(inviteIDs, invite.ID)
			if acceptedInvite == nil {
				inviteCopy := invite
				acceptedInvite = &inviteCopy
			}
		}
	}
	if len(inviteIDs) == 0 {
		return nil, nil
	}

	pipe := rdb.TxPipeline()
	pipe.HDel(ctx, groupInvitesKey(userID), inviteIDs...)
	pipe.HDel(ctx, groupPendingKey(groupID), userID)
	pipe.SAdd(ctx, groupMembersKey(groupID), userID)
	pipe.HSet(ctx, groupMetaKey(groupID), "status", "active")
	pipe.Expire(ctx, groupMetaKey(groupID), groupInviteTTL)
	pipe.Expire(ctx, groupMembersKey(groupID), groupInviteTTL)
	pipe.Expire(ctx, groupPendingKey(groupID), groupInviteTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, fmt.Errorf("delete accepted group invites: %w", err)
	}
	return acceptedInvite, nil
}

func GetRideGroupState(ctx context.Context, rdb *redis.Client, groupID, requesterID string) (string, string, []string, []string, error) {
	meta, err := rdb.HGetAll(ctx, groupMetaKey(groupID)).Result()
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("load group metadata: %w", err)
	}
	if len(meta) == 0 {
		return "", "", nil, nil, ErrGroupNotFound
	}

	isMember, err := rdb.SIsMember(ctx, groupMembersKey(groupID), requesterID).Result()
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("check group access: %w", err)
	}
	if !isMember {
		return "", "", nil, nil, ErrGroupAccessDenied
	}

	members, err := rdb.SMembers(ctx, groupMembersKey(groupID)).Result()
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("load group members: %w", err)
	}
	pending, err := rdb.HKeys(ctx, groupPendingKey(groupID)).Result()
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("load pending group members: %w", err)
	}
	sort.Strings(members)
	sort.Strings(pending)
	return meta["owner_id"], meta["status"], members, pending, nil
}
