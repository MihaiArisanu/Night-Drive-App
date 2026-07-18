package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
)

var (
	ErrUserNotFound           = errors.New("friend request recipient not found")
	ErrSelfRequest            = errors.New("cannot send a friend request to yourself")
	ErrAlreadyFriends         = errors.New("users are already friends")
	ErrRequestAlreadyPending  = errors.New("friend request is already pending")
	ErrIncomingRequestPending = errors.New("recipient already sent a pending request")
	ErrRequestNotFound        = errors.New("pending friend request not found")
	ErrFriendshipNotFound     = errors.New("friendship not found")
)

type existingFriendRequest struct {
	id         string
	senderID   string
	receiverID string
	status     string
}

func resolveExistingFriendRequests(requests []existingFriendRequest, senderID string) (reactivateID string, repairFriendship bool, err error) {
	var sameDirectionRejectedID string
	for _, request := range requests {
		sameDirection := request.senderID == senderID
		switch request.status {
		case "pending":
			if sameDirection {
				return "", false, ErrRequestAlreadyPending
			}
			return "", false, ErrIncomingRequestPending
		case "accepted", "accept":
			return "", true, nil
		case "rejected", "reject":
			if sameDirection {
				sameDirectionRejectedID = request.id
			}
		}
	}
	return sameDirectionRejectedID, false, nil
}

// SendFriendRequest creates or reactivates a request atomically. Locking both
// user rows in a stable order serializes simultaneous A -> B and B -> A sends.
func SendFriendRequest(ctx context.Context, dbConn *sql.DB, senderID string, receiverTag string) (models.FriendRequestSendResult, error) {
	result := models.FriendRequestSendResult{Status: "created"}
	recipient := &result.Recipient

	tx, err := dbConn.BeginTx(ctx, nil)
	if err != nil {
		return result, fmt.Errorf("begin friend request transaction: %w", err)
	}
	defer tx.Rollback()

	err = tx.QueryRowContext(ctx, `
		SELECT id, username, tag
		FROM users
		WHERE tag = $1
		LIMIT 1
	`, receiverTag).Scan(&recipient.ID, &recipient.Name, &recipient.Tag)
	if errors.Is(err, sql.ErrNoRows) {
		return result, ErrUserNotFound
	}
	if err != nil {
		return result, fmt.Errorf("find friend request recipient: %w", err)
	}
	if recipient.ID == senderID {
		return result, ErrSelfRequest
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM users
		WHERE id IN ($1, $2)
		ORDER BY id
		FOR UPDATE
	`, senderID, recipient.ID)
	if err != nil {
		return result, fmt.Errorf("lock friend request users: %w", err)
	}
	lockedUsers := 0
	for rows.Next() {
		lockedUsers++
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result, fmt.Errorf("iterate locked users: %w", err)
	}
	if err := rows.Close(); err != nil {
		return result, fmt.Errorf("close locked users result: %w", err)
	}
	if lockedUsers != 2 {
		return result, ErrUserNotFound
	}

	var areFriends bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM friendships
			WHERE (user_id_1 = $1 AND user_id_2 = $2)
			   OR (user_id_1 = $2 AND user_id_2 = $1)
		)
	`, senderID, recipient.ID).Scan(&areFriends); err != nil {
		return result, fmt.Errorf("check existing friendship: %w", err)
	}
	if areFriends {
		return result, ErrAlreadyFriends
	}

	requestRows, err := tx.QueryContext(ctx, `
		SELECT id, sender_id, receiver_id, status
		FROM friend_requests
		WHERE (sender_id = $1 AND receiver_id = $2)
		   OR (sender_id = $2 AND receiver_id = $1)
		FOR UPDATE
	`, senderID, recipient.ID)
	if err != nil {
		return result, fmt.Errorf("load existing friend requests: %w", err)
	}

	var existingRequests []existingFriendRequest
	for requestRows.Next() {
		var existing existingFriendRequest
		if err := requestRows.Scan(&existing.id, &existing.senderID, &existing.receiverID, &existing.status); err != nil {
			requestRows.Close()
			return result, fmt.Errorf("scan existing friend request: %w", err)
		}
		existingRequests = append(existingRequests, existing)
	}
	if err := requestRows.Err(); err != nil {
		requestRows.Close()
		return result, fmt.Errorf("iterate existing friend requests: %w", err)
	}
	if err := requestRows.Close(); err != nil {
		return result, fmt.Errorf("close existing friend requests result: %w", err)
	}
	sameDirectionRequestID, repairFriendship, err := resolveExistingFriendRequests(existingRequests, senderID)
	if err != nil {
		return result, err
	}

	if repairFriendship {
		u1, u2 := senderID, recipient.ID
		if u1 > u2 {
			u1, u2 = u2, u1
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO friendships (user_id_1, user_id_2)
			VALUES ($1, $2)
			ON CONFLICT DO NOTHING
		`, u1, u2); err != nil {
			return result, fmt.Errorf("repair accepted friendship: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE friend_requests
			SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
			WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
			  AND status IN ('accept', 'accepted')
		`, senderID, recipient.ID); err != nil {
			return result, fmt.Errorf("normalize repaired friend request: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return result, fmt.Errorf("commit repaired friendship: %w", err)
		}
		result.Status = "friendship_repaired"
		return result, nil
	}

	if sameDirectionRequestID != "" {
		_, err = tx.ExecContext(ctx, `
			UPDATE friend_requests
			SET status = 'pending', created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, sameDirectionRequestID)
	} else {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO friend_requests (sender_id, receiver_id, status)
			VALUES ($1, $2, 'pending')
		`, senderID, recipient.ID)
	}
	if err != nil {
		return result, fmt.Errorf("persist friend request: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return result, fmt.Errorf("commit friend request transaction: %w", err)
	}
	return result, nil
}

func GetPendingFriendRequests(ctx context.Context, dbConn *sql.DB, userID string) ([]models.PendingFriendRequest, error) {
	query := `
		SELECT req.id, req.sender_id, u.tag, COALESCE(u.username, u.email, 'User'), req.status, req.created_at
		FROM friend_requests req
		JOIN users u ON req.sender_id = u.id
		WHERE req.receiver_id = $1 AND req.status = 'pending'
	`
	rows, err := dbConn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reqs []models.PendingFriendRequest
	for rows.Next() {
		var p models.PendingFriendRequest
		var createdAt sql.NullTime
		var name sql.NullString

		if err := rows.Scan(&p.ID, &p.SenderID, &p.SenderTag, &name, &p.Status, &createdAt); err != nil {
			return nil, fmt.Errorf("scan pending friend request: %w", err)
		}

		p.Name = name.String
		if createdAt.Valid {
			p.CreatedAt = createdAt.Time.Format(time.RFC3339)
		}

		reqs = append(reqs, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending friend requests: %w", err)
	}

	return reqs, nil
}

func RespondFriendRequest(ctx context.Context, database *sql.DB, requestID, receiverID, action string) error {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin friend request response transaction: %w", err)
	}
	defer tx.Rollback()

	var senderID string
	err = tx.QueryRowContext(ctx, `
		SELECT sender_id
		FROM friend_requests
		WHERE id = $1 AND receiver_id = $2 AND status = 'pending'
		FOR UPDATE
	`, requestID, receiverID).Scan(&senderID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrRequestNotFound
	}
	if err != nil {
		return fmt.Errorf("lock pending friend request: %w", err)
	}

	newStatus := "rejected"
	if action == "accept" {
		newStatus = "accepted"
		u1, u2 := senderID, receiverID
		if senderID > receiverID {
			u1, u2 = receiverID, senderID
		}

		_, err = tx.ExecContext(ctx, `
			INSERT INTO friendships (user_id_1, user_id_2)
			VALUES ($1, $2)
			ON CONFLICT DO NOTHING
		`, u1, u2)
		if err != nil {
			return fmt.Errorf("create friendship: %w", err)
		}
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE friend_requests
		SET status = $1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $2 AND status = 'pending'
	`, newStatus, requestID)
	if err != nil {
		return fmt.Errorf("update friend request status: %w", err)
	}
	if rowsAffected, err := result.RowsAffected(); err != nil || rowsAffected != 1 {
		return ErrRequestNotFound
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit friend request response transaction: %w", err)
	}
	return nil
}

func GetFriends(ctx context.Context, database *sql.DB, userID string) ([]models.Friend, error) {
	query := `
		SELECT u.id, u.username, u.tag, u.profile_picture_url, COALESCE(u.trust_score, 100)
		FROM users u
		JOIN friendships f ON (u.id = f.user_id_1 OR u.id = f.user_id_2)
		WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1) AND u.id != $1
	`
	rows, err := database.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var friends []models.Friend
	for rows.Next() {
		var friend models.Friend
		var profilePic sql.NullString

		if err := rows.Scan(&friend.ID, &friend.Username, &friend.Tag, &profilePic, &friend.TrustScore); err != nil {
			return nil, fmt.Errorf("scan friend: %w", err)
		}

		if profilePic.Valid {
			friend.ProfilePictureURL = &profilePic.String
		}
		friends = append(friends, friend)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate friends: %w", err)
	}

	if friends == nil {
		friends = []models.Friend{}
	}
	return friends, nil
}

// RemoveFriend serializes against friend-request creation by locking both user
// rows in the same stable order used by SendFriendRequest. Accepted historical
// requests are rejected so a future friendship always requires a fresh accept.
func RemoveFriend(ctx context.Context, database *sql.DB, userID, friendID string) error {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin remove friendship transaction: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM users
		WHERE id IN ($1, $2)
		ORDER BY id
		FOR UPDATE
	`, userID, friendID)
	if err != nil {
		return fmt.Errorf("lock friendship users: %w", err)
	}
	lockedUsers := 0
	for rows.Next() {
		lockedUsers++
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate locked friendship users: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close locked friendship users: %w", err)
	}
	if lockedUsers != 2 {
		return ErrFriendshipNotFound
	}

	firstUserID, secondUserID := userID, friendID
	if firstUserID > secondUserID {
		firstUserID, secondUserID = secondUserID, firstUserID
	}
	result, err := tx.ExecContext(ctx, `
		DELETE FROM friendships
		WHERE user_id_1 = $1 AND user_id_2 = $2
	`, firstUserID, secondUserID)
	if err != nil {
		return fmt.Errorf("delete friendship: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read removed friendship count: %w", err)
	}
	if rowsAffected != 1 {
		return ErrFriendshipNotFound
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE friend_requests
		SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
		WHERE ((sender_id = $1 AND receiver_id = $2)
		    OR (sender_id = $2 AND receiver_id = $1))
		  AND status IN ('accept', 'accepted')
	`, userID, friendID); err != nil {
		return fmt.Errorf("close accepted friend requests: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit removed friendship: %w", err)
	}
	return nil
}
