package models

type FriendRequestAction struct {
	Action string `json:"action"`
}

type FriendRequestPayload struct {
	ReceiverTag string `json:"receiverTag"`
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
	ID         string  `json:"id"`
	Username   string  `json:"username"`
	Tag        string  `json:"tag"`
	AvatarURL  *string `json:"avatarUrl"`
	TrustScore float64 `json:"trustScore"`
}
