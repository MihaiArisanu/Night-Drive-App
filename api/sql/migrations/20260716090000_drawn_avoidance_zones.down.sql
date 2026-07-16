DROP INDEX IF EXISTS disliked_areas_drawn_geometry_idx;

ALTER TABLE disliked_areas
    DROP CONSTRAINT IF EXISTS disliked_areas_geometry_check,
    DROP CONSTRAINT IF EXISTS disliked_areas_coverage_type_check,
    DROP COLUMN IF EXISTS drawn_geometry;

ALTER TABLE disliked_areas
    ADD CONSTRAINT disliked_areas_coverage_type_check
        CHECK (coverage_type IN ('area', 'street', 'segment')),
    ADD CONSTRAINT disliked_areas_geometry_check
        CHECK (
            coverage_type = 'area'
            OR (street_name IS NOT NULL AND street_geometry IS NOT NULL)
        );
