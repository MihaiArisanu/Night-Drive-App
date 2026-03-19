ALTER TABLE users 
ADD COLUMN IF NOT EXISTS points INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS trust_score FLOAT DEFAULT 100.0,
ADD COLUMN IF NOT EXISTS tag VARCHAR(5);

CREATE TABLE IF NOT EXISTS friend_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending', 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sender_id, receiver_id),
    CONSTRAINT check_not_self_request CHECK (sender_id != receiver_id) 
);

CREATE INDEX IF NOT EXISTS idx_friend_req_receiver ON friend_requests(receiver_id);

CREATE TABLE IF NOT EXISTS friendships (
    user_id_1 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id_2 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id_1, user_id_2),
    CONSTRAINT enforce_user_order CHECK (user_id_1 < user_id_2) 
);

CREATE INDEX IF NOT EXISTS idx_friendships_user_1 ON friendships(user_id_1);
CREATE INDEX IF NOT EXISTS idx_friendships_user_2 ON friendships(user_id_2);

CREATE TABLE IF NOT EXISTS saved_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    start_point GEOMETRY(Point, 4326),
    end_point GEOMETRY(Point, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);