package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
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

var leaveRideGroupScript = redis.NewScript(`
local meta = KEYS[1]
local members = KEYS[2]
local pending = KEYS[3]

local user_id = ARGV[1]
local user_invites_prefix = ARGV[2]
local ttl_seconds = tonumber(ARGV[3])

if redis.call('EXISTS', meta) == 0 then
  return {'not_found', '', ''}
end
if redis.call('SISMEMBER', members, user_id) == 0 then
  return {'not_member', '', ''}
end

local owner_id = redis.call('HGET', meta, 'owner_id')
redis.call('SREM', members, user_id)

local remaining = redis.call('SMEMBERS', members)
table.sort(remaining)
local dissolved = #remaining == 0
local cancelled_targets = {}
local pending_entries = redis.call('HGETALL', pending)

for index = 1, #pending_entries, 2 do
  local target_id = pending_entries[index]
  local invite_id = pending_entries[index + 1]
  local user_invites = user_invites_prefix .. target_id
  local payload = redis.call('HGET', user_invites, invite_id)
  local should_cancel = dissolved

  if not should_cancel and payload then
    local decoded, invite = pcall(cjson.decode, payload)
    should_cancel = decoded and invite['senderId'] == user_id
  end

  if not payload then
    should_cancel = true
  end

  if should_cancel then
    redis.call('HDEL', pending, target_id)
    redis.call('HDEL', user_invites, invite_id)
    table.insert(cancelled_targets, target_id)
  end
end

table.sort(cancelled_targets)

if dissolved then
  redis.call('DEL', meta, members, pending)
  return {'dissolved', '', table.concat(cancelled_targets, ',')}
end

if owner_id == user_id then
  redis.call('HSET', meta, 'owner_id', remaining[1])
end

redis.call('EXPIRE', meta, ttl_seconds)
redis.call('EXPIRE', members, ttl_seconds)
if redis.call('EXISTS', pending) == 1 then
  redis.call('EXPIRE', pending, ttl_seconds)
end

return {'left', table.concat(remaining, ','), table.concat(cancelled_targets, ',')}
`)

type LeaveRideGroupResult struct {
	AlreadyAbsent            bool
	Dissolved                bool
	RemainingMemberIDs       []string
	CancelledInviteTargetIDs []string
}

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

// LeaveRideGroup atomically removes a user from a ride group. Repeated calls are
// safe: an expired group or an already-removed member is treated as a no-op.
func LeaveRideGroup(ctx context.Context, rdb *redis.Client, groupID, userID string) (LeaveRideGroupResult, error) {
	values, err := leaveRideGroupScript.Run(ctx, rdb, []string{
		groupMetaKey(groupID),
		groupMembersKey(groupID),
		groupPendingKey(groupID),
	}, userID, "group_invites:", int(groupInviteTTL.Seconds())).Slice()
	if err != nil {
		return LeaveRideGroupResult{}, fmt.Errorf("leave ride group: %w", err)
	}
	if len(values) != 3 {
		return LeaveRideGroupResult{}, fmt.Errorf("unexpected leave ride group response length: %d", len(values))
	}

	status, ok := values[0].(string)
	if !ok {
		return LeaveRideGroupResult{}, fmt.Errorf("unexpected leave ride group status: %T", values[0])
	}
	remaining, err := splitRedisIDs(values[1])
	if err != nil {
		return LeaveRideGroupResult{}, err
	}
	cancelledTargets, err := splitRedisIDs(values[2])
	if err != nil {
		return LeaveRideGroupResult{}, err
	}

	result := LeaveRideGroupResult{
		RemainingMemberIDs:       remaining,
		CancelledInviteTargetIDs: cancelledTargets,
	}
	switch status {
	case "left":
		return result, nil
	case "dissolved":
		result.Dissolved = true
		return result, nil
	case "not_found", "not_member":
		result.AlreadyAbsent = true
		return result, nil
	default:
		return LeaveRideGroupResult{}, fmt.Errorf("unexpected leave ride group result: %s", status)
	}
}

func splitRedisIDs(value interface{}) ([]string, error) {
	raw, ok := value.(string)
	if !ok {
		return nil, fmt.Errorf("unexpected Redis ID list: %T", value)
	}
	if raw == "" {
		return []string{}, nil
	}
	return strings.Split(raw, ","), nil
}
