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
}

type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Tag          string    `json:"tag"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

type NearbyUser struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Coordinates
	Heading float64 `json:"heading"`
}
