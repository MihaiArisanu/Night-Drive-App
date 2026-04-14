package models

type DislikeRequest struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Reason    string  `json:"reason"`
}

type DislikeResponse struct {
	ID        string  `json:"id"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Reason    string  `json:"reason"`
	CreatedAt string  `json:"created_at"`
}
