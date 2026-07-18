package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/google/uuid"
)

var (
	ErrSpontaneousOfferConflict = errors.New("a spontaneous ride offer is already pending")
	ErrSpontaneousOfferCooldown = errors.New("spontaneous ride pair is in cooldown")
	ErrSpontaneousOfferNotFound = errors.New("spontaneous ride offer not found")
	ErrSpontaneousOfferResolved = errors.New("spontaneous ride offer is already resolved")
)

func OrderSpontaneousRideUsers(firstUserID, secondUserID string) (string, string) {
	if firstUserID > secondUserID {
		return secondUserID, firstUserID
	}
	return firstUserID, secondUserID
}

func CreateSpontaneousRideOffer(
	ctx context.Context,
	database *sql.DB,
	offer models.SpontaneousRideOffer,
	cooldown time.Duration,
) error {
	offer.FirstUserID, offer.SecondUserID = OrderSpontaneousRideUsers(
		offer.FirstUserID,
		offer.SecondUserID,
	)

	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin spontaneous ride offer: %w", err)
	}
	defer tx.Rollback()

	if err := lockUsers(ctx, tx, offer.FirstUserID, offer.SecondUserID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE spontaneous_ride_offers
		SET status = 'expired', resolved_at = CURRENT_TIMESTAMP
		WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP
	`); err != nil {
		return fmt.Errorf("expire spontaneous ride offers: %w", err)
	}

	var areFriends bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM friendships
			WHERE user_id_1 = $1 AND user_id_2 = $2
		)
	`, offer.FirstUserID, offer.SecondUserID).Scan(&areFriends); err != nil {
		return fmt.Errorf("check spontaneous ride friendship: %w", err)
	}
	if !areFriends {
		return ErrFriendshipNotFound
	}

	var unavailable bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM ride_group_members membership
			JOIN ride_groups ride_group ON ride_group.id = membership.group_id
			WHERE membership.user_id IN ($1, $2)
			  AND membership.status = 'active'
			  AND ride_group.status IN ('draft', 'active')
		)
	`, offer.FirstUserID, offer.SecondUserID).Scan(&unavailable); err != nil {
		return fmt.Errorf("check spontaneous ride group membership: %w", err)
	}
	if unavailable {
		return ErrUserAlreadyInGroup
	}

	var pending bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM spontaneous_ride_offers
			WHERE status = 'pending'
			  AND expires_at > CURRENT_TIMESTAMP
			  AND (
				first_user_id IN ($1, $2)
				OR second_user_id IN ($1, $2)
			  )
		)
	`, offer.FirstUserID, offer.SecondUserID).Scan(&pending); err != nil {
		return fmt.Errorf("check pending spontaneous ride offers: %w", err)
	}
	if pending {
		return ErrSpontaneousOfferConflict
	}

	if cooldown > 0 {
		var coolingDown bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM spontaneous_ride_offers
				WHERE first_user_id = $1
				  AND second_user_id = $2
				  AND created_at > CURRENT_TIMESTAMP - ($3 * INTERVAL '1 second')
			)
		`, offer.FirstUserID, offer.SecondUserID, cooldown.Seconds()).Scan(&coolingDown); err != nil {
			return fmt.Errorf("check spontaneous ride cooldown: %w", err)
		}
		if coolingDown {
			return ErrSpontaneousOfferCooldown
		}
	}

	waypointsJSON, err := json.Marshal(offer.Plan.Waypoints)
	if err != nil {
		return fmt.Errorf("encode spontaneous ride waypoints: %w", err)
	}
	var destinationLatitude interface{}
	var destinationLongitude interface{}
	var destinationName interface{}
	if offer.Plan.Destination != nil {
		destinationLatitude = offer.Plan.Destination.Latitude
		destinationLongitude = offer.Plan.Destination.Longitude
		destinationName = offer.Plan.Destination.Name
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO spontaneous_ride_offers (
			id, first_user_id, second_user_id, navigation_mode,
			destination, destination_name, route_waypoints,
			straight_distance_meters, road_distance_meters,
			created_at, expires_at
		)
		VALUES (
			$1, $2, $3, $4,
			CASE
				WHEN $5::double precision IS NULL OR $6::double precision IS NULL THEN NULL
				ELSE ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography
			END,
			$7, $8::jsonb, $9, $10, $11, $12
		)
	`,
		offer.ID,
		offer.FirstUserID,
		offer.SecondUserID,
		offer.Plan.NavigationMode,
		destinationLatitude,
		destinationLongitude,
		destinationName,
		waypointsJSON,
		offer.StraightDistanceMeters,
		offer.RoadDistanceMeters,
		offer.CreatedAt,
		offer.ExpiresAt,
	); err != nil {
		return fmt.Errorf("persist spontaneous ride offer: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit spontaneous ride offer: %w", err)
	}
	return nil
}

func RespondToSpontaneousRideOffer(
	ctx context.Context,
	database *sql.DB,
	offerID string,
	userID string,
	decision string,
) (models.SpontaneousRideResponseResult, error) {
	result := models.SpontaneousRideResponseResult{OfferID: offerID, Response: decision}
	if decision != "accepted" && decision != "declined" {
		return result, fmt.Errorf("invalid spontaneous ride response: %s", decision)
	}

	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return result, fmt.Errorf("begin spontaneous ride response: %w", err)
	}
	defer tx.Rollback()

	var firstResponse, secondResponse, status string
	var expiresAt time.Time
	var destinationLatitude, destinationLongitude sql.NullFloat64
	var destinationName sql.NullString
	var waypointsJSON []byte
	err = tx.QueryRowContext(ctx, `
		SELECT first_user_id,
		       second_user_id,
		       status,
		       first_response,
		       second_response,
		       expires_at,
		       CASE WHEN destination IS NULL THEN NULL ELSE ST_Y(destination::geometry) END,
		       CASE WHEN destination IS NULL THEN NULL ELSE ST_X(destination::geometry) END,
		       destination_name,
		       route_waypoints
		FROM spontaneous_ride_offers
		WHERE id = $1
		FOR UPDATE
	`, offerID).Scan(
		&result.FirstUserID,
		&result.SecondUserID,
		&status,
		&firstResponse,
		&secondResponse,
		&expiresAt,
		&destinationLatitude,
		&destinationLongitude,
		&destinationName,
		&waypointsJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return result, ErrSpontaneousOfferNotFound
	}
	if err != nil {
		return result, fmt.Errorf("lock spontaneous ride offer: %w", err)
	}
	if userID != result.FirstUserID && userID != result.SecondUserID {
		return result, ErrSpontaneousOfferNotFound
	}
	if status != "pending" {
		result.Status = status
		return result, ErrSpontaneousOfferResolved
	}
	if !expiresAt.After(time.Now()) {
		result.Status = "expired"
		if _, err := tx.ExecContext(ctx, `
			UPDATE spontaneous_ride_offers
			SET status = 'expired', resolved_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, offerID); err != nil {
			return result, fmt.Errorf("expire spontaneous ride response: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return result, fmt.Errorf("commit expired spontaneous ride response: %w", err)
		}
		return result, nil
	}

	responseColumn := "first_response"
	if userID == result.SecondUserID {
		responseColumn = "second_response"
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`
		UPDATE spontaneous_ride_offers SET %s = $2 WHERE id = $1
	`, responseColumn), offerID, decision); err != nil {
		return result, fmt.Errorf("persist spontaneous ride response: %w", err)
	}
	if userID == result.FirstUserID {
		firstResponse = decision
	} else {
		secondResponse = decision
	}

	if decision == "declined" {
		result.Status = "declined"
		if _, err := tx.ExecContext(ctx, `
			UPDATE spontaneous_ride_offers
			SET status = 'declined', resolved_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, offerID); err != nil {
			return result, fmt.Errorf("decline spontaneous ride offer: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return result, fmt.Errorf("commit spontaneous ride decline: %w", err)
		}
		return result, nil
	}

	if firstResponse != "accepted" || secondResponse != "accepted" {
		result.Status = "pending"
		if err := tx.Commit(); err != nil {
			return result, fmt.Errorf("commit spontaneous ride acceptance: %w", err)
		}
		return result, nil
	}

	if err := lockUsers(ctx, tx, result.FirstUserID, result.SecondUserID); err != nil {
		return result, err
	}
	var unavailable bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM ride_group_members membership
			JOIN ride_groups ride_group ON ride_group.id = membership.group_id
			WHERE membership.user_id IN ($1, $2)
			  AND membership.status = 'active'
			  AND ride_group.status IN ('draft', 'active')
		)
	`, result.FirstUserID, result.SecondUserID).Scan(&unavailable); err != nil {
		return result, fmt.Errorf("recheck spontaneous ride availability: %w", err)
	}
	if unavailable {
		result.Status = "failed"
		if _, err := tx.ExecContext(ctx, `
			UPDATE spontaneous_ride_offers
			SET status = 'failed', resolved_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, offerID); err != nil {
			return result, fmt.Errorf("fail unavailable spontaneous ride: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return result, fmt.Errorf("commit unavailable spontaneous ride: %w", err)
		}
		return result, nil
	}

	result.GroupID = uuid.NewString()
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ride_groups (
			id, group_type, status, owner_id, version,
			destination, destination_name, destination_updated_by,
			destination_updated_at, created_at, activated_at, updated_at
		)
		VALUES (
			$1, 'spontaneous', 'active', $2, 1,
			CASE
				WHEN $3::double precision IS NULL OR $4::double precision IS NULL THEN NULL
				ELSE ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography
			END,
			$5,
			CASE
				WHEN $3::double precision IS NULL OR $4::double precision IS NULL THEN NULL
				ELSE $2
			END,
			CASE
				WHEN $3::double precision IS NULL OR $4::double precision IS NULL THEN NULL
				ELSE CURRENT_TIMESTAMP
			END,
			CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		)
	`,
		result.GroupID,
		result.FirstUserID,
		nullFloatValue(destinationLatitude),
		nullFloatValue(destinationLongitude),
		nullStringValue(destinationName),
	); err != nil {
		return result, fmt.Errorf("create spontaneous ride group: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ride_group_members (group_id, user_id, status, joined_at)
		VALUES
			($1, $2, 'active', $4),
			($1, $3, 'active', $4 + INTERVAL '1 microsecond')
	`, result.GroupID, result.FirstUserID, result.SecondUserID, now); err != nil {
		return result, fmt.Errorf("create spontaneous ride memberships: %w", err)
	}

	var waypoints []models.Coordinates
	if err := json.Unmarshal(waypointsJSON, &waypoints); err != nil {
		return result, fmt.Errorf("decode spontaneous ride waypoints: %w", err)
	}
	for index, waypoint := range waypoints {
		var stopID string
		createdAt := now.Add(time.Duration(index+1) * time.Microsecond)
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO group_stops (
				group_id, added_by, name, location, status, created_at
			)
			VALUES (
				$1, $2, $3,
				ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
				'active', $6
			)
			RETURNING id
		`,
			result.GroupID,
			result.FirstUserID,
			fmt.Sprintf("Zen waypoint %d", index+1),
			waypoint.Longitude,
			waypoint.Latitude,
			createdAt,
		).Scan(&stopID); err != nil {
			return result, fmt.Errorf("create spontaneous Zen waypoint: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO group_stop_members (group_stop_id, user_id, status)
			VALUES ($1, $2, 'pending'), ($1, $3, 'pending')
		`, stopID, result.FirstUserID, result.SecondUserID); err != nil {
			return result, fmt.Errorf("assign spontaneous Zen waypoint: %w", err)
		}
	}

	result.Status = "matched"
	if _, err := tx.ExecContext(ctx, `
		UPDATE spontaneous_ride_offers
		SET status = 'matched', group_id = $2, resolved_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, offerID, result.GroupID); err != nil {
		return result, fmt.Errorf("complete spontaneous ride offer: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return result, fmt.Errorf("commit spontaneous ride match: %w", err)
	}
	return result, nil
}

func DeclinePendingSpontaneousOffers(
	ctx context.Context,
	database *sql.DB,
	userID string,
) ([]models.SpontaneousRideResponseResult, error) {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin spontaneous offer cancellation: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT id, first_user_id, second_user_id
		FROM spontaneous_ride_offers
		WHERE status = 'pending'
		  AND expires_at > CURRENT_TIMESTAMP
		  AND (first_user_id = $1 OR second_user_id = $1)
		FOR UPDATE
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("load spontaneous offers to cancel: %w", err)
	}
	results := make([]models.SpontaneousRideResponseResult, 0)
	for rows.Next() {
		var result models.SpontaneousRideResponseResult
		if err := rows.Scan(&result.OfferID, &result.FirstUserID, &result.SecondUserID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan spontaneous offer to cancel: %w", err)
		}
		result.Status = "declined"
		result.Response = "declined"
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate spontaneous offers to cancel: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close spontaneous offers to cancel: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE spontaneous_ride_offers
		SET status = 'declined',
		    first_response = CASE WHEN first_user_id = $1 THEN 'declined' ELSE first_response END,
		    second_response = CASE WHEN second_user_id = $1 THEN 'declined' ELSE second_response END,
		    resolved_at = CURRENT_TIMESTAMP
		WHERE status = 'pending'
		  AND expires_at > CURRENT_TIMESTAMP
		  AND (first_user_id = $1 OR second_user_id = $1)
	`, userID); err != nil {
		return nil, fmt.Errorf("cancel spontaneous offers: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit spontaneous offer cancellation: %w", err)
	}
	return results, nil
}

func lockUsers(ctx context.Context, tx *sql.Tx, firstUserID, secondUserID string) error {
	firstUserID, secondUserID = OrderSpontaneousRideUsers(firstUserID, secondUserID)
	rows, err := tx.QueryContext(ctx, `
		SELECT id FROM users WHERE id IN ($1, $2) ORDER BY id FOR UPDATE
	`, firstUserID, secondUserID)
	if err != nil {
		return fmt.Errorf("lock spontaneous ride users: %w", err)
	}
	count := 0
	for rows.Next() {
		count++
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate spontaneous ride user locks: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close spontaneous ride user locks: %w", err)
	}
	if count != 2 {
		return ErrUserNotFound
	}
	return nil
}

func nullFloatValue(value sql.NullFloat64) interface{} {
	if !value.Valid {
		return nil
	}
	return value.Float64
}

func nullStringValue(value sql.NullString) interface{} {
	if !value.Valid {
		return nil
	}
	return value.String
}
