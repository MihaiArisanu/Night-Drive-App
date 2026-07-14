package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/jackc/pgx/v5/pgconn"
)

const groupInviteTTL = 24 * time.Hour

var (
	ErrGroupMemberExists  = errors.New("user is already a group member")
	ErrGroupInvitePending = errors.New("user already has a pending group invite")
	ErrGroupAccessDenied  = errors.New("user is not allowed to manage this group")
	ErrGroupNotFound      = errors.New("group not found")
	ErrGroupClosed        = errors.New("group is closed")
	ErrGroupNotActive     = errors.New("group is not active")
	ErrGroupOwnerRequired = errors.New("only the group owner can perform this action")
	ErrTooManyGroupStops  = errors.New("group has too many active stops")
	ErrUserAlreadyInGroup = errors.New("user is already in another group")
)

type LeaveRideGroupResult struct {
	AlreadyAbsent            bool
	Dissolved                bool
	NewOwnerID               string
	RemainingMemberIDs       []string
	CancelledInviteTargetIDs []string
}

type CloseRideGroupResult struct {
	AlreadyClosed            bool
	MemberIDs                []string
	CancelledInviteTargetIDs []string
}

// CreateGroupInvite creates the planned group on the first invitation and
// persists both the owner membership and invitation in one transaction.
func CreateGroupInvite(ctx context.Context, dbConn *sql.DB, invite models.GroupInvite) error {
	tx, err := dbConn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin group invitation: %w", err)
	}
	defer tx.Rollback()

	var groupStatus string
	err = tx.QueryRowContext(ctx, `
		SELECT status
		FROM ride_groups
		WHERE id = $1
		FOR UPDATE
	`, invite.GroupID).Scan(&groupStatus)
	if errors.Is(err, sql.ErrNoRows) {
		var alreadyInGroup bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM ride_group_members
				WHERE user_id = $1 AND status = 'active'
			)
		`, invite.SenderID).Scan(&alreadyInGroup); err != nil {
			return fmt.Errorf("check sender group membership: %w", err)
		}
		if alreadyInGroup {
			return ErrUserAlreadyInGroup
		}

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ride_groups (id, group_type, status, owner_id, created_at, updated_at)
			VALUES ($1, 'planned', 'draft', $2, $3, $3)
		`, invite.GroupID, invite.SenderID, invite.CreatedAt); err != nil {
			return fmt.Errorf("create ride group: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ride_group_members (group_id, user_id, status, joined_at)
			VALUES ($1, $2, 'active', $3)
		`, invite.GroupID, invite.SenderID, invite.CreatedAt); err != nil {
			if isUniqueViolation(err, "ride_group_members_one_current_group_per_user") {
				return ErrUserAlreadyInGroup
			}
			return fmt.Errorf("create owner membership: %w", err)
		}
		groupStatus = "draft"
	} else if err != nil {
		return fmt.Errorf("load ride group: %w", err)
	} else {
		if groupStatus == "closed" {
			return ErrGroupClosed
		}
		var senderIsMember bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM ride_group_members
				WHERE group_id = $1 AND user_id = $2 AND status = 'active'
			)
		`, invite.GroupID, invite.SenderID).Scan(&senderIsMember); err != nil {
			return fmt.Errorf("check sender membership: %w", err)
		}
		if !senderIsMember {
			return ErrGroupAccessDenied
		}
	}

	var targetIsMember bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ride_group_members
			WHERE group_id = $1 AND user_id = $2 AND status = 'active'
		)
	`, invite.GroupID, invite.TargetUserID).Scan(&targetIsMember); err != nil {
		return fmt.Errorf("check invited member: %w", err)
	}
	if targetIsMember {
		return ErrGroupMemberExists
	}

	var invitationPending bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ride_group_invites
			WHERE group_id = $1
			  AND target_user_id = $2
			  AND status = 'pending'
			  AND expires_at > CURRENT_TIMESTAMP
		)
	`, invite.GroupID, invite.TargetUserID).Scan(&invitationPending); err != nil {
		return fmt.Errorf("check pending group invitation: %w", err)
	}
	if invitationPending {
		return ErrGroupInvitePending
	}

	// Expired invitations no longer occupy the partial unique index.
	if _, err := tx.ExecContext(ctx, `
		UPDATE ride_group_invites
		SET status = 'expired', responded_at = CURRENT_TIMESTAMP
		WHERE group_id = $1
		  AND target_user_id = $2
		  AND status = 'pending'
		  AND expires_at <= CURRENT_TIMESTAMP
	`, invite.GroupID, invite.TargetUserID); err != nil {
		return fmt.Errorf("expire old group invitations: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ride_group_invites (
			id, group_id, sender_id, target_user_id, status, created_at, expires_at
		)
		VALUES ($1, $2, $3, $4, 'pending', $5, $6)
	`, invite.ID, invite.GroupID, invite.SenderID, invite.TargetUserID,
		invite.CreatedAt, invite.CreatedAt.Add(groupInviteTTL)); err != nil {
		if isUniqueViolation(err, "ride_group_invites_one_pending_per_target") {
			return ErrGroupInvitePending
		}
		return fmt.Errorf("persist group invitation: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit group invitation: %w", err)
	}
	return nil
}

func GetGroupInvites(ctx context.Context, dbConn *sql.DB, userID string) ([]models.GroupInvite, error) {
	if _, err := dbConn.ExecContext(ctx, `
		UPDATE ride_group_invites
		SET status = 'expired', responded_at = CURRENT_TIMESTAMP
		WHERE target_user_id = $1
		  AND status = 'pending'
		  AND expires_at <= CURRENT_TIMESTAMP
	`, userID); err != nil {
		return nil, fmt.Errorf("expire group invitations: %w", err)
	}

	rows, err := dbConn.QueryContext(ctx, `
		SELECT invitation.id,
		       invitation.group_id,
		       invitation.sender_id,
		       COALESCE(sender.username, sender.email, 'Driver'),
		       invitation.target_user_id,
		       invitation.created_at
		FROM ride_group_invites invitation
		JOIN users sender ON sender.id = invitation.sender_id
		JOIN ride_groups ride_group ON ride_group.id = invitation.group_id
		WHERE invitation.target_user_id = $1
		  AND invitation.status = 'pending'
		  AND invitation.expires_at > CURRENT_TIMESTAMP
		  AND ride_group.status <> 'closed'
		ORDER BY invitation.created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("load group invitations: %w", err)
	}
	defer rows.Close()

	invites := make([]models.GroupInvite, 0)
	for rows.Next() {
		var invite models.GroupInvite
		if err := rows.Scan(
			&invite.ID,
			&invite.GroupID,
			&invite.SenderID,
			&invite.SenderName,
			&invite.TargetUserID,
			&invite.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan group invitation: %w", err)
		}
		invites = append(invites, invite)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate group invitations: %w", err)
	}
	return invites, nil
}

func DeleteGroupInvite(ctx context.Context, dbConn *sql.DB, userID, inviteID string) error {
	if _, err := dbConn.ExecContext(ctx, `
		UPDATE ride_group_invites
		SET status = CASE
				WHEN expires_at <= CURRENT_TIMESTAMP THEN 'expired'
				ELSE 'declined'
			END,
			responded_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND target_user_id = $2
		  AND status = 'pending'
	`, inviteID, userID); err != nil {
		return fmt.Errorf("decline group invitation: %w", err)
	}
	return nil
}

func AcceptGroupInvite(ctx context.Context, dbConn *sql.DB, userID, groupID string) (*models.GroupInvite, error) {
	tx, err := dbConn.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin accepting group invitation: %w", err)
	}
	defer tx.Rollback()

	var invite models.GroupInvite
	var expiresAt time.Time
	err = tx.QueryRowContext(ctx, `
		SELECT invitation.id,
		       invitation.group_id,
		       invitation.sender_id,
		       COALESCE(sender.username, sender.email, 'Driver'),
		       invitation.target_user_id,
		       invitation.created_at,
		       invitation.expires_at
		FROM ride_group_invites invitation
		JOIN users sender ON sender.id = invitation.sender_id
		WHERE invitation.group_id = $1
		  AND invitation.target_user_id = $2
		  AND invitation.status = 'pending'
		ORDER BY invitation.created_at
		LIMIT 1
		FOR UPDATE OF invitation
	`, groupID, userID).Scan(
		&invite.ID,
		&invite.GroupID,
		&invite.SenderID,
		&invite.SenderName,
		&invite.TargetUserID,
		&invite.CreatedAt,
		&expiresAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load group invitation: %w", err)
	}
	if !expiresAt.After(time.Now()) {
		if _, err := tx.ExecContext(ctx, `
			UPDATE ride_group_invites
			SET status = 'expired', responded_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, invite.ID); err != nil {
			return nil, fmt.Errorf("expire group invitation: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return nil, fmt.Errorf("commit expired group invitation: %w", err)
		}
		return nil, nil
	}

	var groupStatus string
	if err := tx.QueryRowContext(ctx, `
		SELECT status FROM ride_groups WHERE id = $1 FOR UPDATE
	`, groupID).Scan(&groupStatus); errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, fmt.Errorf("lock ride group: %w", err)
	}
	if groupStatus == "closed" {
		return nil, ErrGroupClosed
	}

	var currentGroupID string
	err = tx.QueryRowContext(ctx, `
		SELECT group_id
		FROM ride_group_members
		WHERE user_id = $1 AND status = 'active'
		FOR UPDATE
	`, userID).Scan(&currentGroupID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load current group membership: %w", err)
	}
	if err == nil && currentGroupID != groupID {
		return nil, ErrUserAlreadyInGroup
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ride_group_members (group_id, user_id, status, joined_at, left_at)
		VALUES ($1, $2, 'active', CURRENT_TIMESTAMP, NULL)
		ON CONFLICT (group_id, user_id) DO UPDATE
		SET status = 'active', joined_at = CURRENT_TIMESTAMP, left_at = NULL
	`, groupID, userID); err != nil {
		if isUniqueViolation(err, "ride_group_members_one_current_group_per_user") {
			return nil, ErrUserAlreadyInGroup
		}
		return nil, fmt.Errorf("activate group membership: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO group_stop_members (group_stop_id, user_id, status)
		SELECT id, $2, 'pending'
		FROM group_stops
		WHERE group_id = $1 AND status = 'active'
		ON CONFLICT DO NOTHING
	`, groupID, userID); err != nil {
		return nil, fmt.Errorf("assign active stops to accepted member: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE ride_groups
		SET status = 'active',
		    activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP),
		    updated_at = CURRENT_TIMESTAMP,
		    version = version + 1
		WHERE id = $1
	`, groupID); err != nil {
		return nil, fmt.Errorf("activate ride group: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ride_group_invites
		SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, invite.ID); err != nil {
		return nil, fmt.Errorf("accept group invitation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ride_group_invites
		SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP
		WHERE target_user_id = $1
		  AND id <> $2
		  AND status = 'pending'
	`, userID, invite.ID); err != nil {
		return nil, fmt.Errorf("cancel competing group invitations: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit accepted group invitation: %w", err)
	}
	return &invite, nil
}

func GetRideGroupState(ctx context.Context, dbConn *sql.DB, groupID, requesterID string) (string, string, []string, []string, error) {
	var ownerID, status string
	err := dbConn.QueryRowContext(ctx, `
		SELECT ride_group.owner_id, ride_group.status
		FROM ride_groups ride_group
		JOIN ride_group_members membership
		  ON membership.group_id = ride_group.id
		 AND membership.user_id = $2
		 AND membership.status = 'active'
		WHERE ride_group.id = $1
	`, groupID, requesterID).Scan(&ownerID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		var exists bool
		if checkErr := dbConn.QueryRowContext(ctx, `
			SELECT EXISTS (SELECT 1 FROM ride_groups WHERE id = $1)
		`, groupID).Scan(&exists); checkErr != nil {
			return "", "", nil, nil, fmt.Errorf("check ride group existence: %w", checkErr)
		}
		if exists {
			return "", "", nil, nil, ErrGroupAccessDenied
		}
		return "", "", nil, nil, ErrGroupNotFound
	}
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("load ride group: %w", err)
	}

	members, err := queryStringColumn(ctx, dbConn, `
		SELECT user_id
		FROM ride_group_members
		WHERE group_id = $1 AND status = 'active'
		ORDER BY joined_at, user_id
	`, groupID)
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("load ride group members: %w", err)
	}
	pending, err := queryStringColumn(ctx, dbConn, `
		SELECT target_user_id
		FROM ride_group_invites
		WHERE group_id = $1
		  AND status = 'pending'
		  AND expires_at > CURRENT_TIMESTAMP
		ORDER BY created_at, target_user_id
	`, groupID)
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("load pending group members: %w", err)
	}
	return ownerID, status, members, pending, nil
}

func GetCurrentRideGroupID(ctx context.Context, dbConn *sql.DB, userID string) (string, error) {
	var groupID string
	err := dbConn.QueryRowContext(ctx, `
		SELECT ride_group.id
		FROM ride_group_members membership
		JOIN ride_groups ride_group ON ride_group.id = membership.group_id
		WHERE membership.user_id = $1
		  AND membership.status = 'active'
		  AND ride_group.status IN ('draft', 'active')
		ORDER BY CASE WHEN ride_group.status = 'active' THEN 0 ELSE 1 END,
		         membership.joined_at
		LIMIT 1
	`, userID).Scan(&groupID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("load current ride group: %w", err)
	}
	return groupID, nil
}

func LeaveRideGroup(ctx context.Context, dbConn *sql.DB, groupID, userID string) (LeaveRideGroupResult, error) {
	tx, err := dbConn.BeginTx(ctx, nil)
	if err != nil {
		return LeaveRideGroupResult{}, fmt.Errorf("begin leaving ride group: %w", err)
	}
	defer tx.Rollback()

	result, err := leaveRideGroupTx(ctx, tx, groupID, userID)
	if err != nil {
		return LeaveRideGroupResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return LeaveRideGroupResult{}, fmt.Errorf("commit leaving ride group: %w", err)
	}
	return result, nil
}

func leaveRideGroupTx(ctx context.Context, tx *sql.Tx, groupID, userID string) (LeaveRideGroupResult, error) {
	result := LeaveRideGroupResult{}
	var ownerID, status string
	err := tx.QueryRowContext(ctx, `
		SELECT owner_id, status FROM ride_groups WHERE id = $1 FOR UPDATE
	`, groupID).Scan(&ownerID, &status)
	if errors.Is(err, sql.ErrNoRows) || status == "closed" {
		result.AlreadyAbsent = true
		return result, nil
	}
	if err != nil {
		return result, fmt.Errorf("lock ride group for leave: %w", err)
	}

	var isMember bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ride_group_members
			WHERE group_id = $1 AND user_id = $2 AND status = 'active'
		)
	`, groupID, userID).Scan(&isMember); err != nil {
		return result, fmt.Errorf("check leaving member: %w", err)
	}
	if !isMember {
		result.AlreadyAbsent = true
		return result, nil
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE ride_group_members
		SET status = 'left', left_at = CURRENT_TIMESTAMP
		WHERE group_id = $1 AND user_id = $2
	`, groupID, userID); err != nil {
		return result, fmt.Errorf("remove ride group member: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE group_stop_members assignment
		SET status = 'skipped', decided_at = CURRENT_TIMESTAMP
		FROM group_stops stop
		WHERE assignment.group_stop_id = stop.id
		  AND stop.group_id = $1
		  AND assignment.user_id = $2
		  AND assignment.status = 'pending'
	`, groupID, userID); err != nil {
		return result, fmt.Errorf("release group stops for leaving member: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE group_stops stop
		SET status = 'completed'
		WHERE stop.group_id = $1
		  AND stop.status = 'active'
		  AND NOT EXISTS (
			SELECT 1 FROM group_stop_members assignment
			WHERE assignment.group_stop_id = stop.id AND assignment.status = 'pending'
		  )
	`, groupID); err != nil {
		return result, fmt.Errorf("complete released group stops: %w", err)
	}

	result.RemainingMemberIDs, err = queryStringColumnTx(ctx, tx, `
		SELECT user_id
		FROM ride_group_members
		WHERE group_id = $1 AND status = 'active'
		ORDER BY joined_at, user_id
	`, groupID)
	if err != nil {
		return result, fmt.Errorf("load remaining group members: %w", err)
	}

	result.CancelledInviteTargetIDs, err = queryStringColumnTx(ctx, tx, `
		SELECT target_user_id
		FROM ride_group_invites
		WHERE group_id = $1 AND sender_id = $2 AND status = 'pending'
		ORDER BY target_user_id
	`, groupID, userID)
	if err != nil {
		return result, fmt.Errorf("load cancelled group invitation targets: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ride_group_invites
		SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP
		WHERE group_id = $1 AND sender_id = $2 AND status = 'pending'
	`, groupID, userID); err != nil {
		return result, fmt.Errorf("cancel invitations from leaving member: %w", err)
	}

	if len(result.RemainingMemberIDs) == 0 {
		result.Dissolved = true
		if _, err := tx.ExecContext(ctx, `
			UPDATE ride_groups
			SET status = 'closed', closed_at = CURRENT_TIMESTAMP,
			    updated_at = CURRENT_TIMESTAMP, version = version + 1
			WHERE id = $1
		`, groupID); err != nil {
			return result, fmt.Errorf("close empty ride group: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE ride_group_invites
			SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP
			WHERE group_id = $1 AND status = 'pending'
		`, groupID); err != nil {
			return result, fmt.Errorf("cancel empty group invitations: %w", err)
		}
		return result, nil
	}

	if ownerID == userID {
		result.NewOwnerID = result.RemainingMemberIDs[0]
		if _, err := tx.ExecContext(ctx, `
			UPDATE ride_groups
			SET owner_id = $2, updated_at = CURRENT_TIMESTAMP, version = version + 1
			WHERE id = $1
		`, groupID, result.NewOwnerID); err != nil {
			return result, fmt.Errorf("transfer ride group ownership: %w", err)
		}
	} else if _, err := tx.ExecContext(ctx, `
		UPDATE ride_groups
		SET updated_at = CURRENT_TIMESTAMP, version = version + 1
		WHERE id = $1
	`, groupID); err != nil {
		return result, fmt.Errorf("update ride group after leave: %w", err)
	}
	return result, nil
}

func CloseRideGroup(ctx context.Context, dbConn *sql.DB, groupID, userID string) (CloseRideGroupResult, error) {
	tx, err := dbConn.BeginTx(ctx, nil)
	if err != nil {
		return CloseRideGroupResult{}, fmt.Errorf("begin closing ride group: %w", err)
	}
	defer tx.Rollback()

	result := CloseRideGroupResult{}
	var ownerID, status string
	err = tx.QueryRowContext(ctx, `
		SELECT owner_id, status FROM ride_groups WHERE id = $1 FOR UPDATE
	`, groupID).Scan(&ownerID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return result, ErrGroupNotFound
	}
	if err != nil {
		return result, fmt.Errorf("lock ride group for close: %w", err)
	}
	if ownerID != userID {
		return result, ErrGroupOwnerRequired
	}
	if status == "closed" {
		result.AlreadyClosed = true
		if err := tx.Commit(); err != nil {
			return result, fmt.Errorf("commit already closed ride group: %w", err)
		}
		return result, nil
	}

	result.MemberIDs, err = queryStringColumnTx(ctx, tx, `
		SELECT user_id FROM ride_group_members
		WHERE group_id = $1 AND status = 'active'
		ORDER BY joined_at, user_id
	`, groupID)
	if err != nil {
		return result, fmt.Errorf("load members for group close: %w", err)
	}
	result.CancelledInviteTargetIDs, err = queryStringColumnTx(ctx, tx, `
		SELECT target_user_id FROM ride_group_invites
		WHERE group_id = $1 AND status = 'pending'
		ORDER BY target_user_id
	`, groupID)
	if err != nil {
		return result, fmt.Errorf("load invitations for group close: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE ride_group_members
		SET status = 'left', left_at = CURRENT_TIMESTAMP
		WHERE group_id = $1 AND status = 'active'
	`, groupID); err != nil {
		return result, fmt.Errorf("close ride group memberships: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ride_group_invites
		SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP
		WHERE group_id = $1 AND status = 'pending'
	`, groupID); err != nil {
		return result, fmt.Errorf("cancel closed group invitations: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ride_groups
		SET status = 'closed', closed_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP, version = version + 1
		WHERE id = $1
	`, groupID); err != nil {
		return result, fmt.Errorf("close ride group: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return result, fmt.Errorf("commit closed ride group: %w", err)
	}
	return result, nil
}

// LeaveRideGroupsForAccountDeletion maintains the owner invariant before the
// users row is removed by the account deletion transaction.
func LeaveRideGroupsForAccountDeletion(ctx context.Context, tx *sql.Tx, userID string) error {
	groupIDs, err := queryStringColumnTx(ctx, tx, `
		SELECT group_id FROM ride_group_members
		WHERE user_id = $1 AND status = 'active'
	`, userID)
	if err != nil {
		return fmt.Errorf("load groups during account deletion: %w", err)
	}
	for _, groupID := range groupIDs {
		if _, err := leaveRideGroupTx(ctx, tx, groupID, userID); err != nil {
			return err
		}
	}
	return nil
}

type rowQueryer interface {
	QueryContext(context.Context, string, ...interface{}) (*sql.Rows, error)
}

func queryStringColumn(ctx context.Context, queryer rowQueryer, query string, args ...interface{}) ([]string, error) {
	rows, err := queryer.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	values := make([]string, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return values, nil
}

func queryStringColumnTx(ctx context.Context, tx *sql.Tx, query string, args ...interface{}) ([]string, error) {
	return queryStringColumn(ctx, tx, query, args...)
}

func isUniqueViolation(err error, constraint string) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) &&
		postgresError.Code == "23505" &&
		postgresError.ConstraintName == constraint
}
