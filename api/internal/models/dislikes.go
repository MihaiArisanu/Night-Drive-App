package models

type DislikeRequest struct {
	Coordinates
	Reason string `json:"reason"`
}

type DislikeResponse struct {
	ID string `json:"id"`
	Coordinates
	Reason    string `json:"reason"`
	CreatedAt string `json:"created_at"`
}
