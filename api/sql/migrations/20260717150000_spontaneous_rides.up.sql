CREATE TABLE spontaneous_ride_offers (
    id UUID PRIMARY KEY,
    first_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    second_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    first_response VARCHAR(20) NOT NULL DEFAULT 'pending',
    second_response VARCHAR(20) NOT NULL DEFAULT 'pending',
    navigation_mode VARCHAR(20) NOT NULL,
    destination GEOGRAPHY(POINT, 4326),
    destination_name VARCHAR(255),
    route_waypoints JSONB NOT NULL DEFAULT '[]'::jsonb,
    straight_distance_meters INTEGER NOT NULL,
    road_distance_meters INTEGER NOT NULL,
    group_id UUID UNIQUE REFERENCES ride_groups(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT spontaneous_ride_offers_distinct_users_check
        CHECK (first_user_id <> second_user_id),
    CONSTRAINT spontaneous_ride_offers_status_check
        CHECK (status IN ('pending', 'declined', 'expired', 'matched', 'failed')),
    CONSTRAINT spontaneous_ride_offers_first_response_check
        CHECK (first_response IN ('pending', 'accepted', 'declined')),
    CONSTRAINT spontaneous_ride_offers_second_response_check
        CHECK (second_response IN ('pending', 'accepted', 'declined')),
    CONSTRAINT spontaneous_ride_offers_navigation_mode_check
        CHECK (navigation_mode IN ('destination', 'zen')),
    CONSTRAINT spontaneous_ride_offers_distance_check
        CHECK (straight_distance_meters >= 0 AND road_distance_meters >= 0)
);

CREATE UNIQUE INDEX spontaneous_ride_offers_one_pending_pair
    ON spontaneous_ride_offers(first_user_id, second_user_id)
    WHERE status = 'pending';

CREATE INDEX spontaneous_ride_offers_first_user_pending
    ON spontaneous_ride_offers(first_user_id, expires_at)
    WHERE status = 'pending';

CREATE INDEX spontaneous_ride_offers_second_user_pending
    ON spontaneous_ride_offers(second_user_id, expires_at)
    WHERE status = 'pending';

CREATE INDEX spontaneous_ride_offers_pair_history
    ON spontaneous_ride_offers(first_user_id, second_user_id, created_at DESC);
