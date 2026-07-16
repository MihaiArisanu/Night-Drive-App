package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/MihaiArisanu/nightdrive-backend/internal/models"
	"github.com/MihaiArisanu/nightdrive-backend/internal/streets"
)

const maxDislikedAreasPerUser = 50

var (
	ErrDislikedAreaAlreadyExists = errors.New("a disliked area already exists nearby")
	ErrDislikedAreaLimitReached  = errors.New("disliked area limit reached")
	ErrInvalidDislikedPolygon    = errors.New("the drawn avoidance zone is invalid")
)

func SaveDislikedStreet(
	dbConn *sql.DB,
	userID string,
	req models.DislikeRequest,
	geometry streets.Geometry,
) error {
	transaction, err := prepareDislikeTransaction(dbConn, userID)
	if err != nil {
		return err
	}
	defer transaction.Rollback()

	alreadyExists, err := dislikedAreaExists(transaction, userID, req, geometry.Name)
	if err != nil {
		return err
	}
	if alreadyExists {
		return ErrDislikedAreaAlreadyExists
	}

	geometryJSON, err := marshalStreetGeometry(geometry.Paths)
	if err != nil {
		return fmt.Errorf("encode disliked street geometry: %w", err)
	}
	if _, err := transaction.Exec(`
		INSERT INTO disliked_areas (
			user_id,
			location,
			reason,
			coverage_type,
			street_name,
			street_geometry,
			avoidance_radius_meters
		)
		VALUES (
			$1,
			ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
			$4,
			'street',
			$5,
			ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326))::geography,
			$7
		)
	`,
		userID,
		req.Longitude,
		req.Latitude,
		req.Reason,
		geometry.Name,
		geometryJSON,
		streets.DefaultCorridorRadiusMeters,
	); err != nil {
		return fmt.Errorf("insert disliked area: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit disliked area: %w", err)
	}
	return nil
}

func SaveDislikedArea(dbConn *sql.DB, userID string, req models.DislikeRequest) error {
	transaction, err := prepareDislikeTransaction(dbConn, userID)
	if err != nil {
		return err
	}
	defer transaction.Rollback()

	alreadyExists, err := dislikedAreaExists(transaction, userID, req, "")
	if err != nil {
		return err
	}
	if alreadyExists {
		return ErrDislikedAreaAlreadyExists
	}
	if _, err := transaction.Exec(`
		INSERT INTO disliked_areas (
			user_id,
			location,
			reason,
			coverage_type,
			avoidance_radius_meters
		)
		VALUES (
			$1,
			ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
			$4,
			'area',
			200.0
		)
	`, userID, req.Longitude, req.Latitude, req.Reason); err != nil {
		return fmt.Errorf("insert disliked area: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit disliked area: %w", err)
	}
	return nil
}

func SaveDrawnDislikedArea(dbConn *sql.DB, userID string, req models.DislikeRequest) error {
	transaction, err := prepareDislikeTransaction(dbConn, userID)
	if err != nil {
		return err
	}
	defer transaction.Rollback()

	geometryJSON, err := marshalPolygonGeometry(req.Polygon)
	if err != nil {
		return ErrInvalidDislikedPolygon
	}

	var alreadyExists bool
	if err := transaction.QueryRow(`
		WITH candidate AS (
			SELECT ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) AS geometry
		)
		SELECT EXISTS (
			SELECT 1
			FROM disliked_areas, candidate
			WHERE user_id = $1
			  AND drawn_geometry IS NOT NULL
			  AND ST_Equals(drawn_geometry::geometry, candidate.geometry)
		)
	`, userID, geometryJSON).Scan(&alreadyExists); err != nil {
		return fmt.Errorf("check duplicate drawn area: %w", err)
	}
	if alreadyExists {
		return ErrDislikedAreaAlreadyExists
	}

	var insertedID string
	if err := transaction.QueryRow(`
		WITH candidate AS (
			SELECT ST_SetSRID(ST_GeomFromGeoJSON($3), 4326) AS geometry
		)
		INSERT INTO disliked_areas (
			user_id,
			location,
			reason,
			coverage_type,
			drawn_geometry,
			avoidance_radius_meters
		)
		SELECT
			$1,
			ST_Centroid(geometry)::geography,
			$2,
			'polygon',
			geometry::geography,
			15.0
		FROM candidate
		WHERE ST_GeometryType(geometry) = 'ST_Polygon'
		  AND ST_IsValid(geometry)
		  AND ST_Area(geometry::geography) BETWEEN 50.0 AND 5000000.0
		RETURNING id
	`, userID, req.Reason, geometryJSON).Scan(&insertedID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrInvalidDislikedPolygon
		}
		return fmt.Errorf("insert drawn disliked area: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit drawn disliked area: %w", err)
	}
	return nil
}

func prepareDislikeTransaction(dbConn *sql.DB, userID string) (*sql.Tx, error) {
	transaction, err := dbConn.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin disliked area transaction: %w", err)
	}
	// Serialize modifications for one user so concurrent requests cannot bypass
	// the limit or create duplicate zones.
	if _, err := transaction.Exec(
		"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
		userID,
	); err != nil {
		transaction.Rollback()
		return nil, fmt.Errorf("lock disliked areas: %w", err)
	}

	var count int
	if err := transaction.QueryRow(
		"SELECT COUNT(*) FROM disliked_areas WHERE user_id = $1",
		userID,
	).Scan(&count); err != nil {
		transaction.Rollback()
		return nil, fmt.Errorf("count disliked areas: %w", err)
	}
	if count >= maxDislikedAreasPerUser {
		transaction.Rollback()
		return nil, ErrDislikedAreaLimitReached
	}
	return transaction, nil
}

func dislikedAreaExists(
	transaction *sql.Tx,
	userID string,
	req models.DislikeRequest,
	streetName string,
) (bool, error) {
	var alreadyExists bool
	if err := transaction.QueryRow(`
		SELECT EXISTS (
			SELECT 1
			FROM disliked_areas
			WHERE user_id = $1
			  AND (
				(
					$4 <> ''
					AND coverage_type IN ('street', 'segment')
					AND LOWER(street_name) = LOWER($4)
				)
				OR ST_DWithin(
					location,
					ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
					50
				)
			  )
		)`, userID, req.Longitude, req.Latitude, streetName).Scan(&alreadyExists); err != nil {
		return false, fmt.Errorf("check duplicate disliked area: %w", err)
	}
	return alreadyExists, nil
}

func GetDislikedAreas(dbConn *sql.DB, userID string) ([]models.DislikedArea, error) {
	rows, err := dbConn.Query(`
		SELECT
			id,
			ST_Y(location::geometry) AS latitude,
			ST_X(location::geometry) AS longitude,
			reason,
			coverage_type,
			COALESCE(street_name, ''),
			avoidance_radius_meters,
			COALESCE(ST_AsGeoJSON(street_geometry), ''),
			COALESCE(ST_AsGeoJSON(drawn_geometry), ''),
			created_at
		FROM disliked_areas
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("query disliked areas: %w", err)
	}
	defer rows.Close()

	areas := make([]models.DislikedArea, 0)
	for rows.Next() {
		var area models.DislikedArea
		var geometryJSON string
		var polygonJSON string
		if err := rows.Scan(
			&area.ID,
			&area.Latitude,
			&area.Longitude,
			&area.Reason,
			&area.CoverageType,
			&area.StreetName,
			&area.AvoidanceRadiusMeters,
			&geometryJSON,
			&polygonJSON,
			&area.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan disliked area: %w", err)
		}
		if geometryJSON != "" {
			paths, err := unmarshalStreetGeometry(geometryJSON)
			if err != nil {
				return nil, fmt.Errorf("decode disliked street geometry: %w", err)
			}
			area.Paths = paths
		}
		if polygonJSON != "" {
			polygon, err := unmarshalPolygonGeometry(polygonJSON)
			if err != nil {
				return nil, fmt.Errorf("decode drawn disliked area: %w", err)
			}
			area.Polygon = polygon
		}
		areas = append(areas, area)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate disliked areas: %w", err)
	}
	return areas, nil
}

type multiLineStringGeoJSON struct {
	Type        string        `json:"type"`
	Coordinates [][][]float64 `json:"coordinates"`
}

type polygonGeoJSON struct {
	Type        string        `json:"type"`
	Coordinates [][][]float64 `json:"coordinates"`
}

func marshalStreetGeometry(paths [][]models.Coordinates) ([]byte, error) {
	coordinates := make([][][]float64, 0, len(paths))
	for _, path := range paths {
		line := make([][]float64, 0, len(path))
		for _, point := range path {
			line = append(line, []float64{point.Longitude, point.Latitude})
		}
		if len(line) >= 2 {
			coordinates = append(coordinates, line)
		}
	}
	if len(coordinates) == 0 {
		return nil, errors.New("street geometry has no valid paths")
	}
	return json.Marshal(multiLineStringGeoJSON{
		Type:        "MultiLineString",
		Coordinates: coordinates,
	})
}

func unmarshalStreetGeometry(value string) ([][]models.Coordinates, error) {
	var geometry multiLineStringGeoJSON
	if err := json.Unmarshal([]byte(value), &geometry); err != nil {
		return nil, err
	}
	if geometry.Type != "MultiLineString" {
		return nil, fmt.Errorf("unexpected geometry type %q", geometry.Type)
	}
	paths := make([][]models.Coordinates, 0, len(geometry.Coordinates))
	for _, line := range geometry.Coordinates {
		path := make([]models.Coordinates, 0, len(line))
		for _, point := range line {
			if len(point) < 2 {
				continue
			}
			path = append(path, models.Coordinates{
				Latitude:  point[1],
				Longitude: point[0],
			})
		}
		if len(path) >= 2 {
			paths = append(paths, path)
		}
	}
	return paths, nil
}

func marshalPolygonGeometry(polygon []models.Coordinates) ([]byte, error) {
	if len(polygon) < 3 {
		return nil, errors.New("polygon has fewer than three points")
	}
	ring := make([][]float64, 0, len(polygon)+1)
	for _, point := range polygon {
		ring = append(ring, []float64{point.Longitude, point.Latitude})
	}
	first := ring[0]
	last := ring[len(ring)-1]
	if first[0] != last[0] || first[1] != last[1] {
		ring = append(ring, []float64{first[0], first[1]})
	}
	return json.Marshal(polygonGeoJSON{
		Type:        "Polygon",
		Coordinates: [][][]float64{ring},
	})
}

func unmarshalPolygonGeometry(value string) ([]models.Coordinates, error) {
	var geometry polygonGeoJSON
	if err := json.Unmarshal([]byte(value), &geometry); err != nil {
		return nil, err
	}
	if geometry.Type != "Polygon" || len(geometry.Coordinates) == 0 {
		return nil, fmt.Errorf("unexpected geometry type %q", geometry.Type)
	}
	ring := geometry.Coordinates[0]
	polygon := make([]models.Coordinates, 0, len(ring))
	for _, point := range ring {
		if len(point) < 2 {
			continue
		}
		polygon = append(polygon, models.Coordinates{
			Latitude:  point[1],
			Longitude: point[0],
		})
	}
	if len(polygon) > 1 && polygon[0] == polygon[len(polygon)-1] {
		polygon = polygon[:len(polygon)-1]
	}
	if len(polygon) < 3 {
		return nil, errors.New("polygon has fewer than three valid points")
	}
	return polygon, nil
}

func DeleteDislikedArea(dbConn *sql.DB, userID string, areaID string) (bool, error) {
	result, err := dbConn.Exec(
		"DELETE FROM disliked_areas WHERE id = $1 AND user_id = $2",
		areaID,
		userID,
	)
	if err != nil {
		return false, fmt.Errorf("delete disliked area: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read deleted disliked area count: %w", err)
	}
	return rowsAffected > 0, nil
}

func UpdateDislikedAreaReason(
	dbConn *sql.DB,
	userID string,
	areaID string,
	reason string,
) (bool, error) {
	result, err := dbConn.Exec(
		"UPDATE disliked_areas SET reason = $1 WHERE id = $2 AND user_id = $3",
		reason,
		areaID,
		userID,
	)
	if err != nil {
		return false, fmt.Errorf("update disliked area: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read updated disliked area count: %w", err)
	}
	return rowsAffected > 0, nil
}
