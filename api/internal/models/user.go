package models

import "time"

type UserCreateRequest struct {
	Username string `json:"username"`
	Tag      string `json:"tag"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Tag          string    `json:"tag"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}
