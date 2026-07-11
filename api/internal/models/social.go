package models

type FriendRequestAction struct {
	Action string `json:"action"`
}

type FriendRequestPayload struct {
	ReceiverTag string `json:"receiverTag"`
}

type FriendRequestRecipient struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Tag  string `json:"tag"`
}

type FriendRequestSendResult struct {
	Status    string                 `json:"status"`
	Recipient FriendRequestRecipient `json:"recipient"`
}

type PendingFriendRequest struct {
	ID        string `json:"id"`
	SenderID  string `json:"senderId"`
	SenderTag string `json:"senderTag"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

type Friend struct {
	ID                string  `json:"id"`
	Username          string  `json:"username"`
	Tag               string  `json:"tag"`
	ProfilePictureURL *string `json:"profile_picture_url,omitempty"`
	TrustScore        float64 `json:"trust_score"`
}
