ALTER TABLE group_stops
    DROP CONSTRAINT IF EXISTS group_stops_added_by_fkey;

ALTER TABLE group_stops
    ADD CONSTRAINT group_stops_added_by_fkey
    FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL;
