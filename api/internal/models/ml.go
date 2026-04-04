package models

import "time"

type LocationPoint struct {
	Latitude   float64   `json:"latitude"`
	Longitude  float64   `json:"longitude"`
	Speed      float64   `json:"speed"`
	RecordedAt time.Time `json:"recordedAt"`
}

type DislikedArea struct {
	ID        string  `json:"id"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Reason    string  `json:"reason"`
}

type DislikedAreaRequest struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Reason    string  `json:"reason"`
}
