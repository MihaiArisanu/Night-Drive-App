package zen

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Waypoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type Plan struct {
	Waypoints   []Waypoint `json:"waypoints"`
	IsColdStart bool       `json:"is_cold_start"`
}

type Planner interface {
	Generate(context.Context, string, float64, float64, float64) (*Plan, error)
}

type EngineError struct {
	StatusCode int
	Code       string
}

func (e *EngineError) Error() string {
	return fmt.Sprintf("zen engine error %d: %s", e.StatusCode, e.Code)
}

type HTTPPlanner struct {
	baseURL        string
	internalSecret string
	client         *http.Client
}

func NewHTTPPlanner(baseURL string, internalSecret string, client *http.Client) *HTTPPlanner {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "http://zen-engine:8000"
	}
	if client == nil {
		client = &http.Client{Timeout: 25 * time.Second}
	}
	return &HTTPPlanner{
		baseURL:        baseURL,
		internalSecret: internalSecret,
		client:         client,
	}
}

func (planner *HTTPPlanner) Generate(
	ctx context.Context,
	subjectID string,
	latitude float64,
	longitude float64,
	heading float64,
) (*Plan, error) {
	payload := struct {
		UserID     string  `json:"user_id"`
		CurrentLat float64 `json:"current_lat"`
		CurrentLng float64 `json:"current_lng"`
		Heading    float64 `json:"heading"`
	}{
		UserID:     subjectID,
		CurrentLat: latitude,
		CurrentLng: longitude,
		Heading:    heading,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode zen request: %w", err)
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		planner.baseURL+"/generate-loop",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create zen request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Secret", planner.internalSecret)

	response, err := planner.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request zen route: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		var errorResponse struct {
			Detail struct {
				Code string `json:"code"`
			} `json:"detail"`
		}
		responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 16*1024))
		_ = json.Unmarshal(responseBody, &errorResponse)
		return nil, &EngineError{
			StatusCode: response.StatusCode,
			Code:       errorResponse.Detail.Code,
		}
	}

	var plan Plan
	if err := json.NewDecoder(response.Body).Decode(&plan); err != nil {
		return nil, fmt.Errorf("decode zen route: %w", err)
	}
	return &plan, nil
}
