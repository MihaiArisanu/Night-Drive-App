package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

func SendFriendRequest(dbConn *sql.DB, senderID string, receiverTag string) error {
	receiver, err := SearchUserByTag(dbConn, receiverTag)
	if err != nil {
		return fmt.Errorf("failed to search user: %w", err)
	}
	if receiver == nil {
		return errors.New("not_found")
	}

	if receiver.ID == senderID {
		return errors.New("self")
	}

	var exists bool
	checkFriendship := `
		SELECT EXISTS(
			SELECT 1 FROM friendships 
			WHERE (user_id_1 = $1 AND user_id_2 = $2) OR (user_id_1 = $2 AND user_id_2 = $1)
		)
	`
	dbConn.QueryRow(checkFriendship, senderID, receiver.ID).Scan(&exists)
	if exists {
		return errors.New("already_friends")
	}

	query := `
		INSERT INTO friend_requests (sender_id, receiver_id, status)
		VALUES ($1, $2, 'pending')
		ON CONFLICT (sender_id, receiver_id) DO NOTHING
	`
	_, err = dbConn.ExecContext(context.Background(), query, senderID, receiver.ID)
	return err
}

func GetPendingFriendRequests(dbConn *sql.DB, userID string) ([]models.PendingFriendRequest, error) {
	query := `
		SELECT req.id, req.sender_id, u.tag, COALESCE(u.username, u.email), req.status, req.created_at
		FROM friend_requests req
		JOIN users u ON req.sender_id = u.id
		WHERE req.receiver_id = $1 AND req.status = 'pending'
	`
	rows, err := dbConn.QueryContext(context.Background(), query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reqs []models.PendingFriendRequest
	for rows.Next() {
		var p models.PendingFriendRequest
		if err := rows.Scan(&p.ID, &p.SenderID, &p.SenderTag, &p.Name, &p.Status, &p.CreatedAt); err != nil {
			continue
		}
		reqs = append(reqs, p)
	}

	return reqs, nil
}

func RespondFriendRequest(dbConn *sql.DB, requestID, receiverID, action string) error {
	tx, err := dbConn.BeginTx(context.Background(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var senderID string
	var status string
	err = tx.QueryRow(`
		SELECT sender_id, status FROM friend_requests 
		WHERE id = $1 AND receiver_id = $2 FOR UPDATE
	`, requestID, receiverID).Scan(&senderID, &status)

	if err != nil {
		if err == sql.ErrNoRows {
			return errors.New("not_found")
		}
		return err
	}

	if status != "pending" {
		return errors.New("already_answered")
	}

	newStatus := "rejected"
	if action == "accept" {
		newStatus = "accepted"

		u1 := senderID
		u2 := receiverID
		if u1 > u2 {
			u1, u2 = u2, u1
		}

		_, err = tx.Exec(`
			INSERT INTO friendships (user_id_1, user_id_2)
			VALUES ($1, $2)
			ON CONFLICT DO NOTHING
		`, u1, u2)
		if err != nil {
			return err
		}
	}

	_, err = tx.Exec(`
		UPDATE friend_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
	`, newStatus, requestID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func GetFriends(db *sql.DB, userID string) ([]models.Friend, error) {
	query := `
        SELECT u.id, u.username, u.tag, NULL as avatar_url, u.trust_score
        FROM users u
        JOIN friendships f ON (f.user_id_1 = u.id OR f.user_id_2 = u.id)
        WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1)
          AND u.id != $1
    `

	rows, err := db.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var friends []models.Friend
	for rows.Next() {
		var friend models.Friend
		var avatar sql.NullString
		var trustScore sql.NullFloat64

		if err := rows.Scan(&friend.ID, &friend.Username, &friend.Tag, &avatar, &trustScore); err != nil {
			fmt.Printf("Error scanning friend row: %v\n", err)
			continue
		}

		if avatar.Valid {
			friend.AvatarURL = &avatar.String
		}
		if trustScore.Valid {
			friend.TrustScore = trustScore.Float64
		} else {
			friend.TrustScore = 100.0
		}

		friends = append(friends, friend)
	}

	if friends == nil {
		friends = []models.Friend{}
	}

	return friends, nil
}
