package models

import "time"

type EventCreateRequest struct {
	UserID      string  `json:"user_id"`
	EventType   string  `json:"event_type"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Description string  `json:"description"`
}

type Event struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	EventType   string    `json:"event_type"`
	Latitude    float64   `json:"latitude"`
	Longitude   float64   `json:"longitude"`
	Description string    `json:"description"`
	Upvotes     int       `json:"upvotes"`
	Downvotes   int       `json:"downvotes"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

type EventVoteRequest struct {
	EventID  string `json:"event_id"`
	VoteType string `json:"vote_type"`
}
