ALTER TABLE disliked_areas
    ADD COLUMN drawn_geometry GEOGRAPHY(Polygon, 4326);

ALTER TABLE disliked_areas
    DROP CONSTRAINT IF EXISTS disliked_areas_coverage_type_check,
    DROP CONSTRAINT IF EXISTS disliked_areas_geometry_check;

ALTER TABLE disliked_areas
    ADD CONSTRAINT disliked_areas_coverage_type_check
        CHECK (coverage_type IN ('area', 'street', 'segment', 'polygon')),
    ADD CONSTRAINT disliked_areas_geometry_check
        CHECK (
            coverage_type = 'area'
            OR (
                coverage_type IN ('street', 'segment')
                AND street_name IS NOT NULL
                AND street_geometry IS NOT NULL
            )
            OR (
                coverage_type = 'polygon'
                AND drawn_geometry IS NOT NULL
                AND ST_IsValid(drawn_geometry::geometry)
                AND ST_Area(drawn_geometry) BETWEEN 50.0 AND 5000000.0
            )
        );

CREATE INDEX disliked_areas_drawn_geometry_idx
    ON disliked_areas USING GIST (drawn_geometry);
