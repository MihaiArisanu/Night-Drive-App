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
	Reason                string          `json:"reason"`
	CoverageType          string          `json:"coverage_type"`
	StreetName            string          `json:"street_name,omitempty"`
	AvoidanceRadiusMeters float64         `json:"avoidance_radius_meters"`
	Paths                 [][]Coordinates `json:"paths,omitempty"`
	CreatedAt             time.Time       `json:"created_at"`
}
