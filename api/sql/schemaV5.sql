CREATE TABLE IF NOT EXISTS location_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    speed FLOAT DEFAULT 0.0,
    recorded_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS location_history_idx ON location_history USING GIST (location);
CREATE INDEX IF NOT EXISTS location_history_user_idx ON location_history(user_id);

CREATE TABLE IF NOT EXISTS disliked_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS disliked_areas_idx ON disliked_areas USING GIST (location);