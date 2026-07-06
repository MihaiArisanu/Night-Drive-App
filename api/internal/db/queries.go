package db

import (
	"context"
	"database/sql"
)

func UpdateFCMToken(ctx context.Context, dbConn *sql.DB, userID string, token string) error {
	_, err := dbConn.ExecContext(ctx, "UPDATE users SET fcm_token = $1 WHERE id = $2", token, userID)
	return err
}

func CreateGroupStop(ctx context.Context, dbConn *sql.DB, groupID, userID, name string, lon, lat float64) error {
	_, err := dbConn.ExecContext(ctx, `
		INSERT INTO group_stops (group_id, added_by, name, location) 
		VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
		groupID, userID, name, lon, lat)
	return err
}
