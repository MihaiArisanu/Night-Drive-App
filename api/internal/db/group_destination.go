package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

// GetGroupNavigationState loads the versioned, durable navigation state. Group
// access is checked by GetRideGroupState before this function is called.
func GetGroupNavigationState(
	ctx context.Context,
	dbConn *sql.DB,
	groupID string,
) (*models.GroupDestination, int64, error) {
	var latitude, longitude sql.NullFloat64
	var name sql.NullString
	var version int64

	err := dbConn.QueryRowContext(ctx, `
		SELECT
			CASE WHEN destination IS NULL THEN NULL ELSE ST_Y(destination::geometry) END,
			CASE WHEN destination IS NULL THEN NULL ELSE ST_X(destination::geometry) END,
			destination_name,
			version
		FROM ride_groups
		WHERE id = $1
	`, groupID).Scan(&latitude, &longitude, &name, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, ErrGroupNotFound
	}
	if err != nil {
		return nil, 0, fmt.Errorf("load group navigation state: %w", err)
	}
	if !latitude.Valid || !longitude.Valid {
		return nil, version, nil
	}

	return &models.GroupDestination{
		Coordinates: models.Coordinates{
			Latitude:  latitude.Float64,
			Longitude: longitude.Float64,
		},
		Name: name.String,
	}, version, nil
}

// UpdateGroupDestination serializes destination changes with membership and
// ownership changes so only the current owner of an active group can write it.
func UpdateGroupDestination(
	ctx context.Context,
	dbConn *sql.DB,
	groupID string,
	userID string,
	destination models.GroupDestination,
) (models.GroupDestinationUpdate, error) {
	tx, err := dbConn.BeginTx(ctx, nil)
	if err != nil {
		return models.GroupDestinationUpdate{}, fmt.Errorf("begin group destination update: %w", err)
	}
	defer tx.Rollback()

	var ownerID sql.NullString
	var status string
	err = tx.QueryRowContext(ctx, `
		SELECT owner_id, status
		FROM ride_groups
		WHERE id = $1
		FOR UPDATE
	`, groupID).Scan(&ownerID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return models.GroupDestinationUpdate{}, ErrGroupNotFound
	}
	if err != nil {
		return models.GroupDestinationUpdate{}, fmt.Errorf("lock group destination: %w", err)
	}

	var isMember bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM ride_group_members
			WHERE group_id = $1 AND user_id = $2 AND status = 'active'
		)
	`, groupID, userID).Scan(&isMember); err != nil {
		return models.GroupDestinationUpdate{}, fmt.Errorf("check destination editor membership: %w", err)
	}
	if !isMember {
		return models.GroupDestinationUpdate{}, ErrGroupAccessDenied
	}
	if status != "active" {
		return models.GroupDestinationUpdate{}, ErrGroupNotActive
	}
	if !ownerID.Valid || ownerID.String != userID {
		return models.GroupDestinationUpdate{}, ErrGroupOwnerRequired
	}

	var version int64
	err = tx.QueryRowContext(ctx, `
		UPDATE ride_groups
		SET destination = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
		    destination_name = $4,
		    destination_updated_by = $5,
		    destination_updated_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP,
		    version = version + 1
		WHERE id = $1
		RETURNING version
	`, groupID, destination.Longitude, destination.Latitude, destination.Name, userID).Scan(&version)
	if err != nil {
		return models.GroupDestinationUpdate{}, fmt.Errorf("persist group destination: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return models.GroupDestinationUpdate{}, fmt.Errorf("commit group destination update: %w", err)
	}

	return models.GroupDestinationUpdate{
		GroupID:     groupID,
		Destination: destination,
		UpdatedBy:   userID,
		Version:     version,
	}, nil
}
