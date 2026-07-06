package db

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func CreateEvent(dbConn *sql.DB, req *models.EventCreateRequest) (*models.Event, error) {
	var ttl time.Duration
	switch req.EventType {
	case "police", "radar":
		ttl = 2 * time.Hour
	case "accident", "hazard":
		ttl = 4 * time.Hour
	case "pothole", "roadwork":
		ttl = 24 * time.Hour
	default:
		ttl = 6 * time.Hour
	}

	expiresAt := time.Now().Add(ttl)

	query := `
		INSERT INTO events (user_id, event_type, location, description, expires_at)
		VALUES (
			$1, 
			$2, 
			ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, 
			$5,
			$6
		)
		RETURNING id, created_at, expires_at
	`

	event := &models.Event{
		UserID:      req.UserID,
		EventType:   req.EventType,
		Coordinates: models.Coordinates{
			Latitude:  req.Latitude,
			Longitude: req.Longitude,
		},
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
		expiresAt,
	).Scan(&event.ID, &event.CreatedAt, &event.ExpiresAt)

	if err != nil {
		return nil, fmt.Errorf("failed to insert event into database: %w", err)
	}

	log.Printf("New event created: [%s] at Lat: %f, Lng: %f (Expiră în: %v)", event.EventType, event.Latitude, event.Longitude, ttl)
	return event, nil
}

func GetNearbyEvents(dbConn *sql.DB, lat, lng, radius float64, limit, offset int) ([]models.Event, error) {
	query := `
		SELECT 
			id, user_id, event_type, 
			ST_Y(location::geometry) as lat, 
			ST_X(location::geometry) as lng, 
			description, upvotes, downvotes, created_at, expires_at,
			ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance
		FROM events
		WHERE ST_DWithin(
			location, 
			ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 
			$3
		)
		AND expires_at > NOW()
		ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
		LIMIT $4 OFFSET $5
	`

	rows, err := dbConn.Query(query, lng, lat, radius, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query nearby events: %v", err)
	}
	defer rows.Close()

	events := []models.Event{}
	for rows.Next() {
		var ev models.Event
		err := rows.Scan(
			&ev.ID, &ev.UserID, &ev.EventType,
			&ev.Latitude, &ev.Longitude,
			&ev.Description, &ev.Upvotes, &ev.Downvotes,
			&ev.CreatedAt, &ev.ExpiresAt,
			&ev.Distance,
		)
		if err != nil {
			continue
		}
		events = append(events, ev)
	}

	return events, nil
}

func VoteEvent(dbConn *sql.DB, eventID string, voteType string) error {
	var query string

	switch voteType {
	case "upvote":
		query = `UPDATE events SET upvotes = upvotes + 1 WHERE id = $1`
	case "downvote":
		query = `UPDATE events SET downvotes = downvotes + 1 WHERE id = $1`
	default:
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

	cleanupQuery := `DELETE FROM events WHERE id = $1 AND (downvotes - upvotes) >= 3`
	_, _ = dbConn.ExecContext(context.Background(), cleanupQuery, eventID)

	return nil
}
