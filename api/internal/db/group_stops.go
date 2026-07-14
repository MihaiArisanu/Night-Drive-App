package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

const MaxActiveGroupStops = 6

type CreateGroupStopResult struct {
	Update            models.GroupStopUpdate
	EligibleMemberIDs []string
}

func CreateGroupStop(
	ctx context.Context,
	dbConn *sql.DB,
	groupID string,
	userID string,
	stop models.GroupStop,
	skippedMembers map[string]bool,
) (CreateGroupStopResult, error) {
	tx, err := dbConn.BeginTx(ctx, nil)
	if err != nil {
		return CreateGroupStopResult{}, fmt.Errorf("begin group stop creation: %w", err)
	}
	defer tx.Rollback()

	var status string
	err = tx.QueryRowContext(ctx, `
		SELECT status FROM ride_groups WHERE id = $1 FOR UPDATE
	`, groupID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return CreateGroupStopResult{}, ErrGroupNotFound
	}
	if err != nil {
		return CreateGroupStopResult{}, fmt.Errorf("lock group for stop creation: %w", err)
	}
	if status != "active" {
		return CreateGroupStopResult{}, ErrGroupNotActive
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT user_id
		FROM ride_group_members
		WHERE group_id = $1 AND status = 'active'
		ORDER BY joined_at, user_id
	`, groupID)
	if err != nil {
		return CreateGroupStopResult{}, fmt.Errorf("load members for group stop: %w", err)
	}
	memberIDs := make([]string, 0)
	requesterIsMember := false
	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			rows.Close()
			return CreateGroupStopResult{}, fmt.Errorf("scan group stop member: %w", err)
		}
		memberIDs = append(memberIDs, memberID)
		requesterIsMember = requesterIsMember || memberID == userID
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return CreateGroupStopResult{}, fmt.Errorf("iterate group stop members: %w", err)
	}
	if err := rows.Close(); err != nil {
		return CreateGroupStopResult{}, fmt.Errorf("close group stop members: %w", err)
	}
	if !requesterIsMember {
		return CreateGroupStopResult{}, ErrGroupAccessDenied
	}

	var activeStops int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM group_stops WHERE group_id = $1 AND status = 'active'
	`, groupID).Scan(&activeStops); err != nil {
		return CreateGroupStopResult{}, fmt.Errorf("count active group stops: %w", err)
	}
	if activeStops >= MaxActiveGroupStops {
		return CreateGroupStopResult{}, ErrTooManyGroupStops
	}

	stop.GroupID = groupID
	stop.AddedBy = userID
	err = tx.QueryRowContext(ctx, `
		INSERT INTO group_stops (group_id, added_by, name, location, status)
		VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 'active')
		RETURNING id, created_at
	`, groupID, userID, stop.Name, stop.Longitude, stop.Latitude).Scan(&stop.ID, &stop.CreatedAt)
	if err != nil {
		return CreateGroupStopResult{}, fmt.Errorf("persist group stop: %w", err)
	}

	eligibleMemberIDs := make([]string, 0, len(memberIDs))
	for _, memberID := range memberIDs {
		memberStatus := "pending"
		decidedAt := sql.NullTime{}
		if skippedMembers[memberID] {
			memberStatus = "skipped"
			decidedAt = sql.NullTime{Time: time.Now().UTC(), Valid: true}
		} else {
			eligibleMemberIDs = append(eligibleMemberIDs, memberID)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO group_stop_members (group_stop_id, user_id, status, decided_at)
			VALUES ($1, $2, $3, $4)
		`, stop.ID, memberID, memberStatus, decidedAt); err != nil {
			return CreateGroupStopResult{}, fmt.Errorf("assign group stop member: %w", err)
		}
	}
	if len(eligibleMemberIDs) == 0 {
		if _, err := tx.ExecContext(ctx, `
			UPDATE group_stops SET status = 'completed' WHERE id = $1
		`, stop.ID); err != nil {
			return CreateGroupStopResult{}, fmt.Errorf("complete group stop skipped by all members: %w", err)
		}
	}

	var version int64
	if err := tx.QueryRowContext(ctx, `
		UPDATE ride_groups
		SET version = version + 1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		RETURNING version
	`, groupID).Scan(&version); err != nil {
		return CreateGroupStopResult{}, fmt.Errorf("version group stop update: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return CreateGroupStopResult{}, fmt.Errorf("commit group stop creation: %w", err)
	}

	return CreateGroupStopResult{
		Update: models.GroupStopUpdate{
			GroupID: groupID,
			Stop:    stop,
			Version: version,
		},
		EligibleMemberIDs: eligibleMemberIDs,
	}, nil
}

func GetPendingGroupStopsForMember(
	ctx context.Context,
	dbConn *sql.DB,
	groupID string,
	userID string,
) ([]models.GroupStop, error) {
	rows, err := dbConn.QueryContext(ctx, `
		SELECT stop.id,
		       stop.group_id,
		       COALESCE(stop.added_by::text, ''),
		       stop.name,
		       ST_Y(stop.location::geometry),
		       ST_X(stop.location::geometry),
		       stop.created_at
		FROM group_stops stop
		JOIN group_stop_members assignment ON assignment.group_stop_id = stop.id
		WHERE stop.group_id = $1
		  AND assignment.user_id = $2
		  AND stop.status = 'active'
		  AND assignment.status = 'pending'
		ORDER BY stop.created_at, stop.id
	`, groupID, userID)
	if err != nil {
		return nil, fmt.Errorf("load pending group stops: %w", err)
	}
	defer rows.Close()

	stops := make([]models.GroupStop, 0)
	for rows.Next() {
		var stop models.GroupStop
		if err := rows.Scan(
			&stop.ID,
			&stop.GroupID,
			&stop.AddedBy,
			&stop.Name,
			&stop.Latitude,
			&stop.Longitude,
			&stop.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan pending group stop: %w", err)
		}
		stops = append(stops, stop)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending group stops: %w", err)
	}
	return stops, nil
}

func ResolveGroupStopForMember(
	ctx context.Context,
	dbConn *sql.DB,
	stopID string,
	userID string,
	status string,
) error {
	if status != "completed" && status != "skipped" {
		return fmt.Errorf("invalid group stop resolution status: %s", status)
	}
	tx, err := dbConn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin group stop resolution: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		UPDATE group_stop_members
		SET status = $3, decided_at = CURRENT_TIMESTAMP
		WHERE group_stop_id = $1 AND user_id = $2 AND status = 'pending'
	`, stopID, userID, status); err != nil {
		return fmt.Errorf("resolve group stop member: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE group_stops stop
		SET status = 'completed'
		WHERE stop.id = $1
		  AND stop.status = 'active'
		  AND NOT EXISTS (
			SELECT 1 FROM group_stop_members assignment
			WHERE assignment.group_stop_id = stop.id AND assignment.status = 'pending'
		  )
	`, stopID); err != nil {
		return fmt.Errorf("complete resolved group stop: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit group stop resolution: %w", err)
	}
	return nil
}
