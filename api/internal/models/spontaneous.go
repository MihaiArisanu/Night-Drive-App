package models

import "time"

const (
	SpontaneousNavigationNone        = "none"
	SpontaneousNavigationDestination = "destination"
)

type LiveNavigation struct {
	Mode        string       `json:"mode"`
	Destination *Coordinates `json:"destination,omitempty"`
}

type SpontaneousRidePlan struct {
	NavigationMode string
	Destination    *GroupDestination
	Waypoints      []Coordinates
}

type SpontaneousRideOffer struct {
	ID                     string
	FirstUserID            string
	SecondUserID           string
	Status                 string
	FirstResponse          string
	SecondResponse         string
	Plan                   SpontaneousRidePlan
	StraightDistanceMeters int
	RoadDistanceMeters     int
	GroupID                string
	CreatedAt              time.Time
	ExpiresAt              time.Time
}

type SpontaneousRideResponseResult struct {
	OfferID      string
	Status       string
	Response     string
	FirstUserID  string
	SecondUserID string
	GroupID      string
}
