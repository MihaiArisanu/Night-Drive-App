-- Stops created by the former Redis-backed groups cannot belong to a durable
-- ride group and must not block the new foreign key.
DELETE FROM group_stops stop
WHERE NOT EXISTS (
    SELECT 1 FROM ride_groups ride_group WHERE ride_group.id = stop.group_id
);

ALTER TABLE group_stops
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active',
    ADD CONSTRAINT group_stops_status_check
        CHECK (status IN ('active', 'completed', 'cancelled')),
    ADD CONSTRAINT group_stops_group_id_fkey
        FOREIGN KEY (group_id) REFERENCES ride_groups(id) ON DELETE CASCADE;

CREATE INDEX group_stops_active_group_idx
    ON group_stops(group_id, created_at, id)
    WHERE status = 'active';

CREATE TABLE group_stop_members (
    group_stop_id UUID NOT NULL REFERENCES group_stops(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (group_stop_id, user_id),
    CONSTRAINT group_stop_members_status_check
        CHECK (status IN ('pending', 'skipped', 'completed'))
);

CREATE INDEX group_stop_members_pending_user_idx
    ON group_stop_members(user_id, group_stop_id)
    WHERE status = 'pending';

INSERT INTO group_stop_members (group_stop_id, user_id, status)
SELECT stop.id, membership.user_id, 'pending'
FROM group_stops stop
JOIN ride_group_members membership
  ON membership.group_id = stop.group_id
 AND membership.status = 'active'
WHERE stop.status = 'active'
ON CONFLICT DO NOTHING;

