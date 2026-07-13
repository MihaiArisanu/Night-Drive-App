package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"

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
		SELECT id, username, tag, email, password_hash, created_at, profile_picture_url
		FROM users 
		WHERE id = $1
	`

	var user models.User
	var profilePic sql.NullString
	err := dbConn.QueryRowContext(context.Background(), query, id).Scan(
		&user.ID, &user.Username, &user.Tag, &user.Email, &user.PasswordHash, &user.CreatedAt, &profilePic,
	)

	if err != nil {
		return nil, err
	}

	if profilePic.Valid {
		user.ProfilePictureURL = profilePic.String
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

type FriendLocationProfile struct {
	ID                string
	Name              string
	ProfilePictureURL string
}

func GetFriendsForLocationSharing(ctx context.Context, dbConn *sql.DB, userID string) ([]FriendLocationProfile, error) {
	const query = `
		SELECT
			u.id,
			u.username,
			COALESCE(u.profile_picture_url, '')
		FROM users u
		JOIN friendships f
		  ON (f.user_id_1 = u.id AND f.user_id_2 = $1)
		  OR (f.user_id_1 = $1 AND f.user_id_2 = u.id)
		ORDER BY u.username, u.id
	`

	rows, err := dbConn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("load friends for location sharing: %w", err)
	}
	defer rows.Close()

	friends := make([]FriendLocationProfile, 0)
	for rows.Next() {
		var friend FriendLocationProfile
		if err := rows.Scan(&friend.ID, &friend.Name, &friend.ProfilePictureURL); err != nil {
			return nil, fmt.Errorf("scan friend for location sharing: %w", err)
		}
		friends = append(friends, friend)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate friends for location sharing: %w", err)
	}
	return friends, nil
}

func GetLocationProfiles(ctx context.Context, dbConn *sql.DB, userIDs []string) ([]FriendLocationProfile, error) {
	if len(userIDs) == 0 {
		return []FriendLocationProfile{}, nil
	}

	placeholders := make([]string, len(userIDs))
	args := make([]interface{}, len(userIDs))
	for index, userID := range userIDs {
		placeholders[index] = fmt.Sprintf("$%d", index+1)
		args[index] = userID
	}
	query := fmt.Sprintf(`
		SELECT id, username, COALESCE(profile_picture_url, '')
		FROM users
		WHERE id IN (%s)
		ORDER BY username, id
	`, strings.Join(placeholders, ","))

	rows, err := dbConn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("load location profiles: %w", err)
	}
	defer rows.Close()

	profiles := make([]FriendLocationProfile, 0, len(userIDs))
	for rows.Next() {
		var profile FriendLocationProfile
		if err := rows.Scan(&profile.ID, &profile.Name, &profile.ProfilePictureURL); err != nil {
			return nil, fmt.Errorf("scan location profile: %w", err)
		}
		profiles = append(profiles, profile)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate location profiles: %w", err)
	}
	return profiles, nil
}

func GetGroupParticipants(ctx context.Context, database *sql.DB, requesterID string, userIDs []string) ([]models.GroupParticipant, error) {
	participants := make([]models.GroupParticipant, 0, len(userIDs))
	const query = `
		SELECT
			u.id,
			u.username,
			u.tag,
			COALESCE(u.profile_picture_url, ''),
			CASE WHEN u.id = $1 THEN false ELSE EXISTS (
				SELECT 1
				FROM friendships f
				WHERE (f.user_id_1 = $1 AND f.user_id_2 = u.id)
				   OR (f.user_id_1 = u.id AND f.user_id_2 = $1)
			) END AS is_friend
		FROM users u
		WHERE u.id = $2
	`

	for _, userID := range userIDs {
		var participant models.GroupParticipant
		if err := database.QueryRowContext(ctx, query, requesterID, userID).Scan(
			&participant.ID,
			&participant.Name,
			&participant.Tag,
			&participant.ProfilePictureURL,
			&participant.IsFriend,
		); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return nil, fmt.Errorf("load group participant: %w", err)
		}
		participants = append(participants, participant)
	}
	return participants, nil
}

func ReplaceAvatar(ctx context.Context, database *sql.DB, userID string, avatarURL string) (string, error) {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin avatar update transaction: %w", err)
	}
	defer tx.Rollback()

	var previousURL string
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(profile_picture_url, '')
		FROM users
		WHERE id = $1
		FOR UPDATE
	`, userID).Scan(&previousURL); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("user not found")
		}
		return "", fmt.Errorf("read previous avatar: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE users
		SET profile_picture_url = $1
		WHERE id = $2
	`, avatarURL, userID); err != nil {
		return "", fmt.Errorf("update avatar: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit avatar update: %w", err)
	}
	return previousURL, nil
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

func UpdateUserProfile(dbConn *sql.DB, userID string, name string, email string) error {
	query := `UPDATE users SET username = $1, email = $2 WHERE id = $3`
	_, err := dbConn.Exec(query, name, email, userID)
	if err != nil {
		return fmt.Errorf("failed to update user profile: %v", err)
	}
	return nil
}
