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

func SaveDislikedArea(dbConn *sql.DB, userID string, req models.DislikedAreaRequest) error {
	query := `
		INSERT INTO disliked_areas (user_id, location, reason)
		VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
	`
	_, err := dbConn.Exec(query, userID, req.Longitude, req.Latitude, req.Reason)
	return err
}

func GetDislikedAreas(dbConn *sql.DB, userID string) ([]models.DislikedArea, error) {
	query := `
		SELECT id, ST_Y(location::geometry) as latitude, ST_X(location::geometry) as longitude, reason
		FROM disliked_areas
		WHERE user_id = $1
		ORDER BY created_at DESC
	`
	rows, err := dbConn.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	areas := []models.DislikedArea{}
	for rows.Next() {
		var a models.DislikedArea
		if err := rows.Scan(&a.ID, &a.Latitude, &a.Longitude, &a.Reason); err == nil {
			areas = append(areas, a)
		}
	}
	return areas, nil
}

func DeleteDislikedArea(dbConn *sql.DB, userID string, areaID string) error {
	query := `DELETE FROM disliked_areas WHERE id = $1 AND user_id = $2`
	_, err := dbConn.Exec(query, areaID, userID)
	return err
}
