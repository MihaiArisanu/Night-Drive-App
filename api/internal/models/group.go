package models

type GroupStopRequest struct {
	Coordinates
	Name string `json:"name"`
}

type InviteRequest struct {
	TargetUserId string  `json:"targetUserId"`
	SenderName   string  `json:"senderName"`
	SenderLat    float64 `json:"senderLat"`
	SenderLng    float64 `json:"senderLng"`
}

type UpdateGroupRequest struct {
	Name         *string  `json:"name,omitempty"`
	MemberIds    []string `json:"memberIds,omitempty"`
	DriverId     *string  `json:"driverId,omitempty"`
	VoiceChannel *bool    `json:"voiceChannel,omitempty"`
}
