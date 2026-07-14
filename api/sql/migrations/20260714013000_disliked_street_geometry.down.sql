DROP INDEX IF EXISTS disliked_areas_street_geometry_idx;

ALTER TABLE disliked_areas
    DROP CONSTRAINT IF EXISTS disliked_areas_geometry_check,
    DROP CONSTRAINT IF EXISTS disliked_areas_avoidance_radius_check,
    DROP CONSTRAINT IF EXISTS disliked_areas_coverage_type_check,
    DROP COLUMN IF EXISTS avoidance_radius_meters,
    DROP COLUMN IF EXISTS street_geometry,
    DROP COLUMN IF EXISTS street_name,
    DROP COLUMN IF EXISTS coverage_type;
