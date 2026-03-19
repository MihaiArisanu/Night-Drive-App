CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    event_type VARCHAR(50) NOT NULL,
    
    location GEOGRAPHY(Point, 4326) NOT NULL,
    
    description TEXT,
    upvotes INT DEFAULT 0,
    downvotes INT DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '2 hours')
);

CREATE INDEX IF NOT EXISTS events_location_idx ON events USING GIST (location);
