ALTER TABLE ride_groups
    ADD COLUMN destination GEOGRAPHY(POINT, 4326),
    ADD COLUMN destination_name VARCHAR(255),
    ADD COLUMN destination_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN destination_updated_at TIMESTAMP WITH TIME ZONE;

