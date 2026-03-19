package db

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func CreateEvent(dbConn *sql.DB, req *models.EventCreateRequest) (*models.Event, error) {
	query := `
		INSERT INTO events (user_id, event_type, location, description)
		VALUES (
			$1, 
			$2, 
			ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, 
			$5
		)
		RETURNING id, created_at, expires_at
	`

	event := &models.Event{
		UserID:      req.UserID,
		EventType:   req.EventType,
		Latitude:    req.Latitude,
		Longitude:   req.Longitude,
		Description: req.Description,
		Upvotes:     0,
		Downvotes:   0,
	}

	err := dbConn.QueryRowContext(
		context.Background(),
		query,
		req.UserID,
		req.EventType,
		req.Longitude,
		req.Latitude,
		req.Description,
	).Scan(&event.ID, &event.CreatedAt, &event.ExpiresAt)

	if err != nil {
		return nil, fmt.Errorf("failed to insert event into database: %w", err)
	}

	log.Printf("New event created: [%s] at Lat: %f, Lng: %f", event.EventType, event.Latitude, event.Longitude)
	return event, nil
}

func GetNearbyEvents(dbConn *sql.DB, lat, lng float64, radiusInMeters float64) ([]models.Event, error) {
	query := `
		SELECT id, user_id, event_type, 
		       ST_Y(location::geometry) as latitude, 
		       ST_X(location::geometry) as longitude, 
		       description, upvotes, downvotes, created_at, expires_at
		FROM events
		WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
		  AND expires_at > CURRENT_TIMESTAMP
	`

	rows, err := dbConn.QueryContext(context.Background(), query, lng, lat, radiusInMeters)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []models.Event{}
	for rows.Next() {
		var e models.Event
		err := rows.Scan(&e.ID, &e.UserID, &e.EventType, &e.Latitude, &e.Longitude,
			&e.Description, &e.Upvotes, &e.Downvotes, &e.CreatedAt, &e.ExpiresAt)
		if err != nil {
			return nil, err
		}
		events = append(events, e)
	}

	return events, nil
}

func VoteEvent(dbConn *sql.DB, eventID string, voteType string) error {
	var query string

	if voteType == "upvote" {
		query = `UPDATE events SET upvotes = upvotes + 1 WHERE id = $1`
	} else if voteType == "downvote" {
		query = `UPDATE events SET downvotes = downvotes + 1 WHERE id = $1`
	} else {
		return fmt.Errorf("invalid vote type")
	}

	result, err := dbConn.ExecContext(context.Background(), query, eventID)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if rowsAffected == 0 {
		return fmt.Errorf("event not found")
	}

	if voteType == "downvote" {
		cleanupQuery := `DELETE FROM events WHERE id = $1 AND downvotes >= 3`
		_, _ = dbConn.ExecContext(context.Background(), cleanupQuery, eventID)
	}

	return nil
}
