package spontaneous

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/MihaiArisanu/nightdrive-backend/internal/db"
	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/push"
	"github.com/MihaiArisanu/nightdrive-backend/internal/routing"
	"github.com/MihaiArisanu/nightdrive-backend/internal/ws"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type Config struct {
	RadiusMeters          float64
	MaxRoadDistanceMeters int
	MaxLocationAge        time.Duration
	MaxAccuracyMeters     float64
	OfferTTL              time.Duration
	PairCooldown          time.Duration
	EvaluationLockTTL     time.Duration
}

func ConfigFromEnvironment() Config {
	return Config{
		RadiusMeters:          floatEnvironment("SPONTANEOUS_RADIUS_METERS", 1000),
		MaxRoadDistanceMeters: int(floatEnvironment("SPONTANEOUS_MAX_ROAD_DISTANCE_METERS", 3000)),
		MaxLocationAge:        durationEnvironment("SPONTANEOUS_LOCATION_MAX_AGE_SECONDS", 12*time.Second),
		MaxAccuracyMeters:     floatEnvironment("SPONTANEOUS_MAX_ACCURACY_METERS", 100),
		OfferTTL:              durationEnvironment("SPONTANEOUS_OFFER_TTL_SECONDS", 10*time.Second),
		PairCooldown:          durationEnvironment("SPONTANEOUS_PAIR_COOLDOWN_SECONDS", 5*time.Minute),
		EvaluationLockTTL:     durationEnvironment("SPONTANEOUS_EVALUATION_LOCK_SECONDS", 30*time.Second),
	}
}

type Service struct {
	database   *sql.DB
	redis      *redis.Client
	router     routing.Planner
	hub        *ws.Hub
	pushSender push.Sender
	config     Config
}

const diagnosticLogTTL = 30 * time.Second

func NewService(
	database *sql.DB,
	redisClient *redis.Client,
	router routing.Planner,
	hub *ws.Hub,
	pushSender push.Sender,
	config Config,
) *Service {
	return &Service{
		database:   database,
		redis:      redisClient,
		router:     router,
		hub:        hub,
		pushSender: pushSender,
		config:     config,
	}
}

func (service *Service) HandleLocationUpdate(userID string, location models.LiveLocation) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	if location.IsDND {
		results, err := db.DeclinePendingSpontaneousOffers(ctx, service.database, userID)
		if err != nil {
			log.Printf("[WARN] Could not decline spontaneous offers after DND: %v", err)
			return
		}
		for _, result := range results {
			service.notifyResolved(result, "dnd")
		}
		return
	}
	if !service.locationEligible(location, time.Now()) {
		service.logDecision(
			ctx,
			userID,
			"location_ineligible",
			"age_seconds=%d accuracy_meters=%.1f",
			time.Now().Unix()-location.Timestamp,
			location.Accuracy,
		)
		return
	}

	locked, err := service.redis.SetNX(
		ctx,
		"spontaneous:scan:"+userID,
		"1",
		5*time.Second,
	).Result()
	if err != nil || !locked {
		return
	}
	closedDraftID, err := db.CloseAbandonedDraftGroupForUser(ctx, service.database, userID)
	if err != nil {
		service.logDecision(ctx, userID, "draft_cleanup_failed", "error=%v", err)
		return
	}
	if closedDraftID != "" {
		log.Printf("[SPONTANEOUS] user=%s closed_abandoned_draft=%s", userID, closedDraftID)
	}
	currentGroupID, err := db.GetCurrentRideGroupID(ctx, service.database, userID)
	if err != nil {
		service.logDecision(ctx, userID, "group_lookup_failed", "error=%v", err)
		return
	}
	if currentGroupID != "" {
		service.logDecision(ctx, userID, "already_in_group", "group_id=%s", currentGroupID)
		return
	}

	friends, err := db.GetFriendsForLocationSharing(ctx, service.database, userID)
	if err != nil {
		service.logDecision(ctx, userID, "friend_lookup_failed", "error=%v", err)
		return
	}
	if len(friends) == 0 {
		service.logDecision(ctx, userID, "no_friends", "")
		return
	}
	friendIDs := make([]string, len(friends))
	for index, friend := range friends {
		friendIDs[index] = friend.ID
	}
	locations, err := db.GetLiveLocations(ctx, service.redis, friendIDs)
	if err != nil {
		service.logDecision(ctx, userID, "friend_locations_failed", "error=%v", err)
		return
	}

	type candidate struct {
		profile  db.FriendLocationProfile
		location models.LiveLocation
		distance float64
	}
	candidates := make([]candidate, 0)
	now := time.Now()
	dndCount := 0
	ineligibleCount := 0
	outsideRadiusCount := 0
	for _, friend := range friends {
		friendLocation, exists := locations[friend.ID]
		if !exists {
			continue
		}
		if friendLocation.IsDND {
			dndCount++
			continue
		}
		if !service.locationEligible(friendLocation, now) {
			ineligibleCount++
			continue
		}
		distance := routing.DistanceMeters(
			toRoutingCoordinate(location.Coordinates),
			toRoutingCoordinate(friendLocation.Coordinates),
		)
		if distance > service.config.RadiusMeters {
			outsideRadiusCount++
			continue
		}
		candidates = append(candidates, candidate{
			profile:  friend,
			location: friendLocation,
			distance: distance,
		})
	}
	sort.Slice(candidates, func(first, second int) bool {
		return candidates[first].distance < candidates[second].distance
	})
	if len(candidates) == 0 {
		service.logDecision(
			ctx,
			userID,
			"no_nearby_candidate",
			"friends=%d live=%d dnd=%d stale_or_inaccurate=%d outside_radius=%d",
			len(friends),
			len(locations),
			dndCount,
			ineligibleCount,
			outsideRadiusCount,
		)
		return
	}

	for _, candidate := range candidates {
		if service.evaluateCandidate(ctx, userID, location, candidate) {
			return
		}
	}
}

func (service *Service) Respond(
	ctx context.Context,
	userID string,
	offerID string,
	decision string,
) (models.SpontaneousRideResponseResult, error) {
	if decision == "accepted" {
		location, err := db.GetLiveLocation(ctx, service.redis, userID)
		if err != nil || location.IsDND || !service.locationEligible(location, time.Now()) {
			decision = "declined"
		}
	}
	result, err := db.RespondToSpontaneousRideOffer(
		ctx,
		service.database,
		offerID,
		userID,
		decision,
	)
	if err != nil {
		return result, err
	}
	switch result.Status {
	case "declined", "expired", "failed":
		service.notifyResolved(result, result.Status)
	case "matched":
		service.notifyMatched(result)
	}
	return result, nil
}

func (service *Service) evaluateCandidate(
	ctx context.Context,
	userID string,
	location models.LiveLocation,
	candidate struct {
		profile  db.FriendLocationProfile
		location models.LiveLocation
		distance float64
	},
) bool {
	if _, err := db.CloseAbandonedDraftGroupForUser(ctx, service.database, candidate.profile.ID); err != nil {
		service.logDecision(ctx, userID, "candidate_draft_cleanup_failed", "candidate=%s error=%v", candidate.profile.ID, err)
		return false
	}
	currentGroupID, err := db.GetCurrentRideGroupID(ctx, service.database, candidate.profile.ID)
	if err != nil {
		service.logDecision(ctx, userID, "candidate_group_lookup_failed", "candidate=%s error=%v", candidate.profile.ID, err)
		return false
	}
	if currentGroupID != "" {
		service.logDecision(ctx, userID, "candidate_in_group", "candidate=%s group_id=%s", candidate.profile.ID, currentGroupID)
		return false
	}
	plan, compatible := sharedPlan(location, candidate.location)
	if !compatible {
		service.logDecision(
			ctx,
			userID,
			"both_have_destinations",
			"candidate=%s",
			candidate.profile.ID,
		)
		return false
	}
	firstUserID, secondUserID := db.OrderSpontaneousRideUsers(userID, candidate.profile.ID)
	pairCooldownKey := "spontaneous:cooldown:" + firstUserID + ":" + secondUserID
	busyCount, err := service.redis.Exists(
		ctx,
		"spontaneous:active:"+firstUserID,
		"spontaneous:active:"+secondUserID,
		pairCooldownKey,
	).Result()
	if err != nil || busyCount > 0 {
		return false
	}
	lockKey := "spontaneous:evaluate:" + firstUserID + ":" + secondUserID
	locked, err := service.redis.SetNX(ctx, lockKey, "1", service.config.EvaluationLockTTL).Result()
	if err != nil || !locked {
		return false
	}

	firstRoute, secondRoute := service.roadRoutes(ctx, location, candidate.location)
	bestRoute := selectBestRoadRoute(firstRoute, secondRoute)
	if bestRoute == nil || bestRoute.DistanceMeters > service.config.MaxRoadDistanceMeters {
		roadDistance := -1
		if bestRoute != nil {
			roadDistance = bestRoute.DistanceMeters
		}
		service.logDecision(
			ctx,
			userID,
			"road_distance_rejected",
			"candidate=%s straight_meters=%.0f road_meters=%d max_road_meters=%d",
			candidate.profile.ID,
			candidate.distance,
			roadDistance,
			service.config.MaxRoadDistanceMeters,
		)
		return false
	}

	createdAt := time.Now().UTC()
	offer := models.SpontaneousRideOffer{
		ID:                     uuid.NewString(),
		FirstUserID:            firstUserID,
		SecondUserID:           secondUserID,
		Plan:                   plan,
		StraightDistanceMeters: int(math.Round(candidate.distance)),
		RoadDistanceMeters:     bestRoute.DistanceMeters,
		CreatedAt:              createdAt,
		ExpiresAt:              createdAt.Add(service.config.OfferTTL),
	}
	if err := db.CreateSpontaneousRideOffer(ctx, service.database, offer, service.config.PairCooldown); err != nil {
		if !errors.Is(err, db.ErrSpontaneousOfferConflict) &&
			!errors.Is(err, db.ErrSpontaneousOfferCooldown) &&
			!errors.Is(err, db.ErrUserAlreadyInGroup) {
			log.Printf("[WARN] Could not create spontaneous ride offer: %v", err)
		}
		return false
	}
	pipeline := service.redis.Pipeline()
	pipeline.Set(ctx, "spontaneous:active:"+firstUserID, offer.ID, service.config.OfferTTL)
	pipeline.Set(ctx, "spontaneous:active:"+secondUserID, offer.ID, service.config.OfferTTL)
	pipeline.Set(ctx, pairCooldownKey, offer.ID, service.config.PairCooldown)
	if _, err := pipeline.Exec(ctx); err != nil {
		log.Printf("[WARN] Could not cache spontaneous ride cooldown: %v", err)
	}

	profiles, err := db.GetLocationProfiles(ctx, service.database, []string{firstUserID, secondUserID})
	names := map[string]string{
		firstUserID:  "A friend",
		secondUserID: "A friend",
	}
	if err == nil {
		for _, profile := range profiles {
			names[profile.ID] = profile.Name
		}
	}
	service.notifyOffer(offer, names)
	log.Printf(
		"[SPONTANEOUS] offer_created=%s users=%s,%s straight_meters=%d road_meters=%d expires_at=%s",
		offer.ID,
		offer.FirstUserID,
		offer.SecondUserID,
		offer.StraightDistanceMeters,
		offer.RoadDistanceMeters,
		offer.ExpiresAt.Format(time.RFC3339),
	)
	return true
}

type routeResult struct {
	forward bool
	plan    *routing.PlanResult
	err     error
}

func (service *Service) roadRoutes(
	ctx context.Context,
	first models.LiveLocation,
	second models.LiveLocation,
) (routeResult, routeResult) {
	results := make(chan routeResult, 2)
	go func() {
		plan, err := service.router.Plan(ctx, routing.PlanRequest{
			Origin:      toRoutingCoordinate(first.Coordinates),
			Destination: toRoutingCoordinate(second.Coordinates),
		}, nil)
		results <- routeResult{forward: true, plan: plan, err: err}
	}()
	go func() {
		plan, err := service.router.Plan(ctx, routing.PlanRequest{
			Origin:      toRoutingCoordinate(second.Coordinates),
			Destination: toRoutingCoordinate(first.Coordinates),
		}, nil)
		results <- routeResult{forward: false, plan: plan, err: err}
	}()
	firstResult := <-results
	secondResult := <-results
	if firstResult.forward {
		return firstResult, secondResult
	}
	return secondResult, firstResult
}

func selectBestRoadRoute(
	firstResult routeResult,
	secondResult routeResult,
) *routing.PlanResult {
	valid := func(result routeResult) bool { return result.err == nil && result.plan != nil }
	switch {
	case !valid(firstResult) && !valid(secondResult):
		return nil
	case valid(firstResult) && (!valid(secondResult) || firstResult.plan.DistanceMeters <= secondResult.plan.DistanceMeters):
		return firstResult.plan
	default:
		return secondResult.plan
	}
}

func sharedPlan(
	first models.LiveLocation,
	second models.LiveLocation,
) (models.SpontaneousRidePlan, bool) {
	firstDestination := explicitDestination(first.Navigation)
	secondDestination := explicitDestination(second.Navigation)
	if firstDestination != nil && secondDestination != nil {
		return models.SpontaneousRidePlan{}, false
	}
	if destination := firstDestination; destination != nil {
		return destinationPlan(*destination), true
	}
	if destination := secondDestination; destination != nil {
		return destinationPlan(*destination), true
	}
	return models.SpontaneousRidePlan{
		NavigationMode: models.SpontaneousNavigationNone,
	}, true
}

func destinationPlan(destination models.Coordinates) models.SpontaneousRidePlan {
	return models.SpontaneousRidePlan{
		NavigationMode: models.SpontaneousNavigationDestination,
		Destination: &models.GroupDestination{
			Coordinates: destination,
			Name:        "Shared destination",
		},
	}
}

func explicitDestination(navigation *models.LiveNavigation) *models.Coordinates {
	if navigation == nil || navigation.Mode != "destination" || navigation.Destination == nil {
		return nil
	}
	return navigation.Destination
}

func (service *Service) locationEligible(location models.LiveLocation, now time.Time) bool {
	if location.Timestamp <= 0 || now.Unix()-location.Timestamp > int64(service.config.MaxLocationAge.Seconds()) {
		return false
	}
	return location.Accuracy <= 0 || location.Accuracy <= service.config.MaxAccuracyMeters
}

func (service *Service) logDecision(
	ctx context.Context,
	userID string,
	reason string,
	format string,
	args ...interface{},
) {
	key := "spontaneous:diagnostic:" + userID + ":" + reason
	shouldLog, err := service.redis.SetNX(ctx, key, "1", diagnosticLogTTL).Result()
	if err == nil && !shouldLog {
		return
	}
	details := fmt.Sprintf(format, args...)
	if details == "" {
		log.Printf("[SPONTANEOUS] user=%s decision=%s", userID, reason)
		return
	}
	log.Printf("[SPONTANEOUS] user=%s decision=%s %s", userID, reason, details)
}

func (service *Service) notifyOffer(offer models.SpontaneousRideOffer, names map[string]string) {
	for _, recipientID := range []string{offer.FirstUserID, offer.SecondUserID} {
		friendID := offer.FirstUserID
		if recipientID == offer.FirstUserID {
			friendID = offer.SecondUserID
		}
		payload := map[string]interface{}{
			"type":         "SPONTANEOUS_RIDE_OFFER",
			"targetUserId": recipientID,
			"payload": map[string]interface{}{
				"offerId":            offer.ID,
				"friendId":           friendID,
				"friendName":         names[friendID],
				"distanceMeters":     offer.StraightDistanceMeters,
				"roadDistanceMeters": offer.RoadDistanceMeters,
				"expiresAt":          offer.ExpiresAt,
			},
		}
		message, err := json.Marshal(payload)
		delivered := err == nil && service.hub.SendToUser(recipientID, message)
		if delivered {
			continue
		}
		go func(userID, friendName string) {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			if err := service.pushSender.SendToUser(ctx, userID, push.Notification{
				Title: "A friend is nearby",
				Body:  friendName + " can start a spontaneous ride with you.",
				Type:  "SPONTANEOUS_RIDE_OFFER",
				Data: map[string]string{
					"offerId":            offer.ID,
					"friendName":         friendName,
					"distanceMeters":     strconv.Itoa(offer.StraightDistanceMeters),
					"roadDistanceMeters": strconv.Itoa(offer.RoadDistanceMeters),
					"expiresAt":          offer.ExpiresAt.Format(time.RFC3339Nano),
				},
			}); err != nil {
				log.Printf("[WARN] Could not send spontaneous ride push: %v", err)
			}
		}(recipientID, names[friendID])
	}
}

func (service *Service) notifyResolved(result models.SpontaneousRideResponseResult, reason string) {
	message, err := json.Marshal(map[string]interface{}{
		"type": "SPONTANEOUS_RIDE_RESOLVED",
		"payload": map[string]string{
			"offerId": result.OfferID,
			"status":  result.Status,
			"reason":  reason,
		},
	})
	if err != nil {
		return
	}
	service.hub.SendToUser(result.FirstUserID, message)
	service.hub.SendToUser(result.SecondUserID, message)
}

func (service *Service) notifyMatched(result models.SpontaneousRideResponseResult) {
	message, err := json.Marshal(map[string]interface{}{
		"type": "SPONTANEOUS_RIDE_MATCHED",
		"payload": map[string]string{
			"offerId": result.OfferID,
			"groupId": result.GroupID,
		},
	})
	if err != nil {
		return
	}
	service.hub.SendToUser(result.FirstUserID, message)
	service.hub.SendToUser(result.SecondUserID, message)
}

func toRoutingCoordinate(coordinates models.Coordinates) routing.Coordinate {
	return routing.Coordinate{Latitude: coordinates.Latitude, Longitude: coordinates.Longitude}
}

func floatEnvironment(key string, fallback float64) float64 {
	value, err := strconv.ParseFloat(os.Getenv(key), 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func durationEnvironment(key string, fallback time.Duration) time.Duration {
	seconds := floatEnvironment(key, fallback.Seconds())
	return time.Duration(seconds * float64(time.Second))
}

func (service *Service) String() string {
	return fmt.Sprintf(
		"spontaneous rides radius=%.0fm road=%dm ttl=%s cooldown=%s",
		service.config.RadiusMeters,
		service.config.MaxRoadDistanceMeters,
		service.config.OfferTTL,
		service.config.PairCooldown,
	)
}
