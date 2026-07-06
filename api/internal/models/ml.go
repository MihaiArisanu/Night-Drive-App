package models

import "time"

type LocationPoint struct {
	Coordinates
	Speed      float64   `json:"speed"`
	RecordedAt time.Time `json:"recordedAt"`
}

type DislikedArea struct {
	ID string `json:"id"`
	Coordinates
	Reason string `json:"reason"`
}
