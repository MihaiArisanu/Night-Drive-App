package db

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	AuthSessionTTL    = 30 * 24 * time.Hour
	LoginChallengeTTL = 2 * time.Minute
)

var (
	ErrLoginChallengeExpired = errors.New("login challenge is invalid or expired")
	ErrAuthSessionChanged    = errors.New("active authentication session changed")
)

type AuthSession struct {
	SessionID string
	DeviceID  string
	CreatedAt time.Time
}

type LoginChallenge struct {
	UserID            string `json:"userId"`
	DeviceID          string `json:"deviceId"`
	ExpectedSessionID string `json:"expectedSessionId"`
}

func authSessionKey(userID string) string {
	return "auth_session:" + userID
}

func loginChallengeKey(challenge string) string {
	digest := sha256.Sum256([]byte(challenge))
	return "login_challenge:" + hex.EncodeToString(digest[:])
}

func GetAuthSession(ctx context.Context, rdb *redis.Client, userID string) (*AuthSession, error) {
	values, err := rdb.HGetAll(ctx, authSessionKey(userID)).Result()
	if err != nil {
		return nil, fmt.Errorf("load auth session: %w", err)
	}
	return parseAuthSession(values), nil
}

func StartAuthSession(
	ctx context.Context,
	rdb *redis.Client,
	userID string,
	session AuthSession,
	refreshToken string,
) (bool, *AuthSession, error) {
	var existing *AuthSession
	err := watchAuthSession(ctx, rdb, userID, func(tx *redis.Tx, current *AuthSession) error {
		existing = current
		if current != nil && current.DeviceID != session.DeviceID {
			return ErrAuthSessionChanged
		}
		return writeAuthSession(ctx, tx, userID, session, refreshToken)
	})
	switch {
	case errors.Is(err, ErrAuthSessionChanged):
		return false, existing, nil
	case err != nil:
		return false, nil, err
	default:
		return true, existing, nil
	}
}

func ClaimAuthSession(
	ctx context.Context,
	rdb *redis.Client,
	userID string,
	expectedSessionID string,
	session AuthSession,
	refreshToken string,
) (*AuthSession, error) {
	var previous *AuthSession
	err := watchAuthSession(ctx, rdb, userID, func(tx *redis.Tx, current *AuthSession) error {
		previous = current
		if current != nil && current.SessionID != expectedSessionID {
			return ErrAuthSessionChanged
		}
		return writeAuthSession(ctx, tx, userID, session, refreshToken)
	})
	if err != nil {
		return nil, err
	}
	return previous, nil
}

func AdoptLegacyAuthSession(
	ctx context.Context,
	rdb *redis.Client,
	userID string,
	sessionID string,
) (bool, error) {
	script := redis.NewScript(`
		local current = redis.call("HGET", KEYS[1], "session_id")
		if current then
			if current == ARGV[1] then
				redis.call("EXPIRE", KEYS[1], ARGV[2])
				return 1
			end
			return 0
		end
		redis.call("HSET", KEYS[1],
			"session_id", ARGV[1],
			"device_id", "legacy",
			"created_at", ARGV[3])
		redis.call("EXPIRE", KEYS[1], ARGV[2])
		return 1
	`)
	result, err := script.Run(
		ctx,
		rdb,
		[]string{authSessionKey(userID)},
		sessionID,
		int64(AuthSessionTTL/time.Second),
		time.Now().UTC().Unix(),
	).Int()
	if err != nil {
		return false, fmt.Errorf("adopt legacy auth session: %w", err)
	}
	return result == 1, nil
}

func ValidateAuthSession(
	ctx context.Context,
	rdb *redis.Client,
	userID string,
	sessionID string,
) (bool, error) {
	script := redis.NewScript(`
		local current = redis.call("HGET", KEYS[1], "session_id")
		if current == ARGV[1] then
			redis.call("EXPIRE", KEYS[1], ARGV[2])
			return 1
		end
		return 0
	`)
	result, err := script.Run(
		ctx,
		rdb,
		[]string{authSessionKey(userID)},
		sessionID,
		int64(AuthSessionTTL/time.Second),
	).Int()
	if err != nil {
		return false, fmt.Errorf("validate auth session: %w", err)
	}
	return result == 1, nil
}

func RotateSessionRefreshToken(
	ctx context.Context,
	rdb *redis.Client,
	userID string,
	sessionID string,
	refreshToken string,
) (bool, error) {
	script := redis.NewScript(`
		local current = redis.call("HGET", KEYS[1], "session_id")
		if current ~= ARGV[1] then
			return 0
		end
		redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
		redis.call("EXPIRE", KEYS[1], ARGV[3])
		return 1
	`)
	result, err := script.Run(
		ctx,
		rdb,
		[]string{authSessionKey(userID), "refresh_token:" + userID},
		sessionID,
		refreshToken,
		int64(AuthSessionTTL/time.Second),
	).Int()
	if err != nil {
		return false, fmt.Errorf("rotate session refresh token: %w", err)
	}
	return result == 1, nil
}

func EndAuthSession(
	ctx context.Context,
	rdb *redis.Client,
	userID string,
	sessionID string,
) (bool, error) {
	script := redis.NewScript(`
		local current = redis.call("HGET", KEYS[1], "session_id")
		if current ~= ARGV[1] then
			return 0
		end
		redis.call("DEL", KEYS[1], KEYS[2], KEYS[3])
		return 1
	`)
	result, err := script.Run(
		ctx,
		rdb,
		[]string{
			authSessionKey(userID),
			"refresh_token:" + userID,
			"live_loc:" + userID,
		},
		sessionID,
	).Int()
	if err != nil {
		return false, fmt.Errorf("end auth session: %w", err)
	}
	return result == 1, nil
}

func CreateLoginChallenge(
	ctx context.Context,
	rdb *redis.Client,
	challenge LoginChallenge,
) (string, error) {
	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("generate login challenge: %w", err)
	}
	value := base64.RawURLEncoding.EncodeToString(randomBytes)
	payload, err := json.Marshal(challenge)
	if err != nil {
		return "", fmt.Errorf("encode login challenge: %w", err)
	}
	if err := rdb.Set(ctx, loginChallengeKey(value), payload, LoginChallengeTTL).Err(); err != nil {
		return "", fmt.Errorf("store login challenge: %w", err)
	}
	return value, nil
}

func ConsumeLoginChallenge(
	ctx context.Context,
	rdb *redis.Client,
	value string,
) (LoginChallenge, error) {
	payload, err := rdb.GetDel(ctx, loginChallengeKey(value)).Bytes()
	if errors.Is(err, redis.Nil) {
		return LoginChallenge{}, ErrLoginChallengeExpired
	}
	if err != nil {
		return LoginChallenge{}, fmt.Errorf("consume login challenge: %w", err)
	}
	var challenge LoginChallenge
	if err := json.Unmarshal(payload, &challenge); err != nil ||
		challenge.UserID == "" ||
		challenge.DeviceID == "" ||
		challenge.ExpectedSessionID == "" {
		return LoginChallenge{}, ErrLoginChallengeExpired
	}
	return challenge, nil
}

func LegacySessionID(token string) string {
	digest := sha256.Sum256([]byte(token))
	return "legacy:" + hex.EncodeToString(digest[:16])
}

func watchAuthSession(
	ctx context.Context,
	rdb *redis.Client,
	userID string,
	update func(*redis.Tx, *AuthSession) error,
) error {
	key := authSessionKey(userID)
	for attempt := 0; attempt < 3; attempt++ {
		err := rdb.Watch(ctx, func(tx *redis.Tx) error {
			values, err := tx.HGetAll(ctx, key).Result()
			if err != nil {
				return err
			}
			return update(tx, parseAuthSession(values))
		}, key)
		if !errors.Is(err, redis.TxFailedErr) {
			if err != nil && !errors.Is(err, ErrAuthSessionChanged) {
				return fmt.Errorf("update auth session: %w", err)
			}
			return err
		}
	}
	return fmt.Errorf("update auth session: %w", redis.TxFailedErr)
}

func writeAuthSession(
	ctx context.Context,
	tx *redis.Tx,
	userID string,
	session AuthSession,
	refreshToken string,
) error {
	_, err := tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		key := authSessionKey(userID)
		pipe.HSet(ctx, key, map[string]interface{}{
			"session_id": session.SessionID,
			"device_id":  session.DeviceID,
			"created_at": session.CreatedAt.UTC().Unix(),
		})
		pipe.Expire(ctx, key, AuthSessionTTL)
		pipe.Set(ctx, "refresh_token:"+userID, refreshToken, AuthSessionTTL)
		return nil
	})
	if err != nil {
		return fmt.Errorf("persist auth session: %w", err)
	}
	return nil
}

func parseAuthSession(values map[string]string) *AuthSession {
	sessionID := values["session_id"]
	deviceID := values["device_id"]
	if sessionID == "" || deviceID == "" {
		return nil
	}
	createdAtUnix, _ := strconv.ParseInt(values["created_at"], 10, 64)
	return &AuthSession{
		SessionID: sessionID,
		DeviceID:  deviceID,
		CreatedAt: time.Unix(createdAtUnix, 0).UTC(),
	}
}
