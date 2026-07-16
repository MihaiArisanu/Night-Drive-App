package models

import "time"

type UserCreateRequest struct {
	Username string `json:"username" validate:"required,min=3,max=32"`
	Tag      string `json:"tag" validate:"required,min=4,max=20"`
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8"`
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
	DeviceID string `json:"device_id" validate:"omitempty,min=16,max=128"`
}

type User struct {
	ID                string    `json:"id"`
	Username          string    `json:"username"`
	Tag               string    `json:"tag"`
	Email             string    `json:"email"`
	PasswordHash      string    `json:"-"`
	ProfilePictureURL string    `json:"profile_picture_url,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
}

type NearbyUser struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	ProfilePictureURL string `json:"profile_picture_url,omitempty"`
	Coordinates
	Heading float64 `json:"heading"`
}

type LiveLocation struct {
	Coordinates
	Heading   float64 `json:"heading"`
	Speed     float64 `json:"speed"`
	IsDND     bool    `json:"isDnd"`
	Timestamp int64   `json:"timestamp"`
}
