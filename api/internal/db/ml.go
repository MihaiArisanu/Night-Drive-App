package db

import (
	"database/sql"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func SaveLocationHistory(dbConn *sql.DB, userID string, points []models.LocationPoint) error {
	tx, err := dbConn.Begin()
	if err != nil {
		return err
	}

	query := `
		INSERT INTO location_history (user_id, location, speed, recorded_at)
		VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5)
	`

	stmt, err := tx.Prepare(query)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()

	for _, p := range points {
		_, err := stmt.Exec(userID, p.Longitude, p.Latitude, p.Speed, p.RecordedAt)
		if err != nil {
			tx.Rollback()
			return err
		}
	}

	return tx.Commit()
}
