package push

import (
	"context"
	"fmt"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/messaging"
)

type Notification struct {
	Title string
	Body  string
	Type  string
	Data  map[string]string
}

type Sender interface {
	SendToUser(ctx context.Context, userID string, notification Notification) error
}

type DisabledSender struct{}

func (DisabledSender) SendToUser(context.Context, string, Notification) error {
	return nil
}

type TokenLookup func(ctx context.Context, userID string) (string, error)
type TokenInvalidator func(ctx context.Context, userID, token string) error

type FirebaseSender struct {
	client          *messaging.Client
	lookupToken     TokenLookup
	invalidateToken TokenInvalidator
}

func NewFirebaseSender(
	ctx context.Context,
	projectID string,
	lookupToken TokenLookup,
	invalidateToken TokenInvalidator,
) (*FirebaseSender, error) {
	if credentialsPath := strings.TrimSpace(os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")); credentialsPath != "" {
		if _, err := os.Stat(credentialsPath); err != nil {
			return nil, fmt.Errorf("Firebase credentials unavailable at %s: %w", credentialsPath, err)
		}
	}

	config := &firebase.Config{ProjectID: strings.TrimSpace(projectID)}
	app, err := firebase.NewApp(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("initialize Firebase app: %w", err)
	}
	client, err := app.Messaging(ctx)
	if err != nil {
		return nil, fmt.Errorf("initialize Firebase Messaging: %w", err)
	}
	return &FirebaseSender{
		client:          client,
		lookupToken:     lookupToken,
		invalidateToken: invalidateToken,
	}, nil
}

func (sender *FirebaseSender) SendToUser(ctx context.Context, userID string, notification Notification) error {
	token, err := sender.lookupToken(ctx, userID)
	if err != nil {
		return err
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}

	data := make(map[string]string, len(notification.Data)+1)
	for key, value := range notification.Data {
		data[key] = value
	}
	data["notificationType"] = notification.Type

	_, err = sender.client.Send(ctx, &messaging.Message{
		Token: token,
		Notification: &messaging.Notification{
			Title: notification.Title,
			Body:  notification.Body,
		},
		Data: data,
		Android: &messaging.AndroidConfig{
			Priority: "high",
			Notification: &messaging.AndroidNotification{
				Sound: "default",
			},
		},
	})
	if err == nil {
		return nil
	}
	if messaging.IsRegistrationTokenNotRegistered(err) {
		if clearErr := sender.invalidateToken(ctx, userID, token); clearErr != nil {
			return fmt.Errorf("send push notification: %w; clear stale token: %v", err, clearErr)
		}
	}
	return fmt.Errorf("send push notification: %w", err)
}
