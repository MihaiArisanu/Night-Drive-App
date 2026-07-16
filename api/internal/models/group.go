package models

import "time"

type GroupStopRequest struct {
	Coordinates
	Name string `json:"name"`
}

type GroupStop struct {
	ID      string `json:"id"`
	GroupID string `json:"groupId"`
	AddedBy string `json:"addedBy,omitempty"`
	Coordinates
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type GroupStopUpdate struct {
	GroupID              string    `json:"groupId"`
	Stop                 GroupStop `json:"stop"`
	Version              int64     `json:"version"`
	AppliesToCurrentUser bool      `json:"appliesToCurrentUser"`
}

type GroupStopCancellation struct {
	GroupID         string `json:"groupId"`
	StopID          string `json:"stopId"`
	CancelledForAll bool   `json:"cancelledForAll"`
	Version         int64  `json:"version"`
}

type InviteRequest struct {
	TargetUserId string  `json:"targetUserId"`
	SenderName   string  `json:"senderName"`
	SenderLat    float64 `json:"senderLat"`
	SenderLng    float64 `json:"senderLng"`
	GroupID      string  `json:"groupId,omitempty"`
}

type GroupInvite struct {
	ID           string    `json:"id"`
	GroupID      string    `json:"groupId"`
	SenderID     string    `json:"senderId"`
	SenderName   string    `json:"senderName"`
	TargetUserID string    `json:"targetUserId"`
	CreatedAt    time.Time `json:"createdAt"`
}

type GroupParticipant struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Tag               string `json:"tag"`
	ProfilePictureURL string `json:"profile_picture_url,omitempty"`
	IsFriend          bool   `json:"isFriend"`
}

type GroupDestination struct {
	Coordinates
	Name string `json:"name"`
}

type GroupDestinationUpdate struct {
	GroupID     string           `json:"groupId"`
	Destination GroupDestination `json:"destination"`
	UpdatedBy   string           `json:"updatedBy"`
	Version     int64            `json:"version"`
}

type GroupDetails struct {
	ID          string             `json:"id"`
	OwnerID     string             `json:"ownerId"`
	Status      string             `json:"status"`
	Version     int64              `json:"version"`
	Destination *GroupDestination  `json:"destination"`
	Stops       []GroupStop        `json:"stops"`
	Members     []GroupParticipant `json:"members"`
	Pending     []GroupParticipant `json:"pending"`
}

type UpdateGroupRequest struct {
	Name         *string  `json:"name,omitempty"`
	MemberIds    []string `json:"memberIds,omitempty"`
	DriverId     *string  `json:"driverId,omitempty"`
	VoiceChannel *bool    `json:"voiceChannel,omitempty"`
}
