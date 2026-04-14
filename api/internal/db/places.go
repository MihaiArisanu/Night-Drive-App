package db

import (
	"database/sql"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func GetSavedPlaces(dbConn *sql.DB, userID string) ([]models.PlaceResponse, error) {
	query := `
		SELECT id, name, ST_Y(location::geometry) as latitude, ST_X(location::geometry) as longitude
		FROM saved_places
		WHERE user_id = $1
		ORDER BY created_at DESC
	`
	rows, err := dbConn.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	places := []models.PlaceResponse{}
	for rows.Next() {
		var p models.PlaceResponse
		if err := rows.Scan(&p.ID, &p.Name, &p.Latitude, &p.Longitude); err == nil {
			places = append(places, p)
		}
	}
	return places, nil
}

func SavePlace(dbConn *sql.DB, userID string, req models.PlaceRequest) error {
	query := `
		INSERT INTO saved_places (user_id, name, location)
		VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)
	`
	_, err := dbConn.Exec(query, userID, req.Name, req.Longitude, req.Latitude)
	return err
}
