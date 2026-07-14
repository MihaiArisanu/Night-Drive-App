package models

type DislikeRequest struct {
	Coordinates
	Reason       string `json:"reason"`
	CoverageType string `json:"coverage_type,omitempty"`
}
