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
