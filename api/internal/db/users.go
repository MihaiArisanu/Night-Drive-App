package db

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func CreateUser(dbConn *sql.DB, user *models.User) error {
	query := `
		INSERT INTO users (username, tag, email, password_hash)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at
	`

	err := dbConn.QueryRowContext(
		context.Background(),
		query,
		user.Username,
		user.Tag,
		user.Email,
		user.PasswordHash,
	).Scan(&user.ID, &user.CreatedAt)

	if err != nil {
		return fmt.Errorf("failed to insert user into database: %w", err)
	}

	log.Printf("Successfully created new user: %s with ID: %s", user.Username, user.ID)
	return nil
}

func GetUserByEmail(dbConn *sql.DB, email string) (*models.User, error) {
	query := `
		SELECT id, username, tag, email, password_hash, created_at 
		FROM users 
		WHERE email = $1
	`

	var user models.User
	err := dbConn.QueryRowContext(context.Background(), query, email).Scan(
		&user.ID, &user.Username, &user.Tag, &user.Email, &user.PasswordHash, &user.CreatedAt,
	)

	if err != nil {
		return nil, err
	}

	return &user, nil
}

func GetUserByID(dbConn *sql.DB, id string) (*models.User, error) {
	query := `
		SELECT id, username, tag, email, password_hash, created_at 
		FROM users 
		WHERE id = $1
	`

	var user models.User
	err := dbConn.QueryRowContext(context.Background(), query, id).Scan(
		&user.ID, &user.Username, &user.Tag, &user.Email, &user.PasswordHash, &user.CreatedAt,
	)

	if err != nil {
		return nil, err
	}

	return &user, nil
}

type UserSearchResponse struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Tag      string `json:"tag"`
}

func SearchUserByTag(dbConn *sql.DB, tag string) (*UserSearchResponse, error) {
	query := `SELECT id, username, tag FROM users WHERE tag = $1 LIMIT 1`

	user := &UserSearchResponse{}
	err := dbConn.QueryRow(query, tag).Scan(&user.ID, &user.Username, &user.Tag)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("database error: %v", err)
	}

	return user, nil
}

func GetNearbyActiveUsers(dbConn *sql.DB, lat, lng float64, userID string) ([]models.NearbyUser, error) {
	query := `
		SELECT 
			u.id, 
			u.username as name, 
			ST_Y(u.location::geometry) as latitude, 
			ST_X(u.location::geometry) as longitude, 
			COALESCE(u.heading, 0.0) as heading
		FROM users u
		JOIN friendships f ON (f.user_id_1 = u.id AND f.user_id_2 = $3) OR (f.user_id_1 = $3 AND f.user_id_2 = u.id)
		WHERE u.is_dnd = false
		  AND u.location IS NOT NULL
		  AND ST_DWithin(
			u.location, 
			ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 
			50000
		  )
	`

	rows, err := dbConn.Query(query, lng, lat, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query nearby users: %v", err)
	}
	defer rows.Close()

	users := []models.NearbyUser{}
	for rows.Next() {
		var u models.NearbyUser
		err := rows.Scan(&u.ID, &u.Name, &u.Latitude, &u.Longitude, &u.Heading)
		if err != nil {
			continue
		}
		users = append(users, u)
	}

	return users, nil
}

func UpdateAvatar(db *sql.DB, userID string, avatarURL string) error {
	query := `UPDATE users SET avatar_url = $1 WHERE id = $2`
	_, err := db.Exec(query, avatarURL, userID)
	if err != nil {
		return fmt.Errorf("eroare la actualizarea avatarului: %v", err)
	}
	return nil
}

func UpdateFCMToken(db *sql.DB, userID string, token string) error {
	query := `UPDATE users SET fcm_token = $1 WHERE id = $2`
	_, err := db.Exec(query, token, userID)
	if err != nil {
		return fmt.Errorf("eroare la actualizarea tokenului FCM: %v", err)
	}
	return nil
}

func UpdateUserLocation(dbConn *sql.DB, userID string, lat, lng, heading, speed float64, isDnd bool) error {
	query := `
		UPDATE users
		SET location       = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
		    heading        = $3,
		    is_dnd         = $4
		WHERE id = $5
	`
	_, err := dbConn.Exec(query, lng, lat, heading, isDnd, userID)
	return err
}

func UpdateUserPassword(dbConn *sql.DB, userID string, newPasswordHash string) error {
	query := `UPDATE users SET password_hash = $1 WHERE id = $2`
	_, err := dbConn.Exec(query, newPasswordHash, userID)
	if err != nil {
		return fmt.Errorf("failed to update user password: %v", err)
	}
	return nil
}
