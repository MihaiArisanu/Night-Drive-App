ALTER TABLE disliked_areas
    ADD COLUMN coverage_type VARCHAR(20) NOT NULL DEFAULT 'area',
    ADD COLUMN street_name VARCHAR(255),
    ADD COLUMN street_geometry GEOGRAPHY(MultiLineString, 4326),
    ADD COLUMN avoidance_radius_meters DOUBLE PRECISION NOT NULL DEFAULT 200.0;

ALTER TABLE disliked_areas
    ADD CONSTRAINT disliked_areas_coverage_type_check
        CHECK (coverage_type IN ('area', 'street', 'segment')),
    ADD CONSTRAINT disliked_areas_avoidance_radius_check
        CHECK (avoidance_radius_meters BETWEEN 5.0 AND 500.0),
    ADD CONSTRAINT disliked_areas_geometry_check
        CHECK (
            coverage_type = 'area'
            OR (street_name IS NOT NULL AND street_geometry IS NOT NULL)
        );

CREATE INDEX disliked_areas_street_geometry_idx
    ON disliked_areas USING GIST (street_geometry);
