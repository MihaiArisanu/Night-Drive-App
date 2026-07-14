DROP TABLE IF EXISTS group_stop_members;

DROP INDEX IF EXISTS group_stops_active_group_idx;

ALTER TABLE group_stops
    DROP CONSTRAINT IF EXISTS group_stops_group_id_fkey,
    DROP CONSTRAINT IF EXISTS group_stops_status_check,
    DROP COLUMN IF EXISTS status;

