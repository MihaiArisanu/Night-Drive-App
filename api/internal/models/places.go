package models

import "time"

type PlaceRequest struct {
	Name string `json:"name"`
	Coordinates
}

type PlacePatchRequest struct {
	Name string `json:"name"`
}

type PlaceResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Coordinates
	CreatedAt time.Time `json:"created_at"`
}
