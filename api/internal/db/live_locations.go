package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/redis/go-redis/v9"
)

const LiveLocationTTL = time.Minute

var ErrLiveLocationNotFound = errors.New("live location not found")

func liveLocationKey(userID string) string {
	return "live_loc:" + userID
}

func SaveLiveLocation(ctx context.Context, rdb *redis.Client, userID string, location models.LiveLocation) error {
	payload, err := json.Marshal(location)
	if err != nil {
		return fmt.Errorf("encode live location: %w", err)
	}
	if err := rdb.Set(ctx, liveLocationKey(userID), payload, LiveLocationTTL).Err(); err != nil {
		return fmt.Errorf("save live location: %w", err)
	}
	return nil
}

func GetLiveLocation(ctx context.Context, rdb *redis.Client, userID string) (models.LiveLocation, error) {
	payload, err := rdb.Get(ctx, liveLocationKey(userID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return models.LiveLocation{}, ErrLiveLocationNotFound
	}
	if err != nil {
		return models.LiveLocation{}, fmt.Errorf("load live location: %w", err)
	}

	var location models.LiveLocation
	if err := json.Unmarshal(payload, &location); err != nil {
		return models.LiveLocation{}, fmt.Errorf("decode live location: %w", err)
	}
	return location, nil
}

func GetLiveLocations(ctx context.Context, rdb *redis.Client, userIDs []string) (map[string]models.LiveLocation, error) {
	locations := make(map[string]models.LiveLocation, len(userIDs))
	if len(userIDs) == 0 {
		return locations, nil
	}

	keys := make([]string, len(userIDs))
	for index, userID := range userIDs {
		keys[index] = liveLocationKey(userID)
	}
	values, err := rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, fmt.Errorf("load live locations: %w", err)
	}

	for index, value := range values {
		payload, ok := value.(string)
		if !ok {
			continue
		}
		var location models.LiveLocation
		if err := json.Unmarshal([]byte(payload), &location); err != nil {
			continue
		}
		locations[userIDs[index]] = location
	}
	return locations, nil
}

func DeleteLiveLocation(ctx context.Context, rdb *redis.Client, userID string) error {
	if err := rdb.Del(ctx, liveLocationKey(userID)).Err(); err != nil {
		return fmt.Errorf("delete live location: %w", err)
	}
	return nil
}

func DeleteLegacyLocationIndex(ctx context.Context, rdb *redis.Client) error {
	if err := rdb.Del(ctx, "drivers_geo").Err(); err != nil {
		return fmt.Errorf("delete legacy location index: %w", err)
	}
	return nil
}
