package models

import "time"

type EventCreateRequest struct {
	UserID    string `json:"user_id"`
	EventType string `json:"event_type"`
	Coordinates
	Description string `json:"description"`
}

type Event struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	EventType string `json:"event_type"`
	Coordinates
	Description string    `json:"description"`
	Upvotes     int       `json:"upvotes"`
	Downvotes   int       `json:"downvotes"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	Distance    float64   `json:"distance,omitempty"`
}

type EventVoteRequest struct {
	EventID  string `json:"event_id"`
	VoteType string `json:"vote_type"`
}
