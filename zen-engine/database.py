import os
import json
import asyncpg
from typing import List

from models import HistoryRecord, ExclusionZone

DATABASE_URL = os.getenv("DATABASE_URL")

RADIUS_METERS = 10000  
EXCLUSION_SEARCH_RADIUS_METERS = 15000

async def get_db_pool():
    if not DATABASE_URL:
        raise ValueError("EROARE: DATABASE_URL nu este setată de Docker Compose!")
    return await asyncpg.create_pool(DATABASE_URL)

async def fetch_history(pool, user_id: str, lat: float, lng: float) -> List[HistoryRecord]:
    query = """
        SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude 
        FROM location_history 
        WHERE user_id = $1 
          AND speed BETWEEN 30 AND 80
          AND recorded_at >= NOW() - INTERVAL '6 months'
          AND ST_DWithin(
              location, 
              ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 
              $4
          );
    """
    async with pool.acquire() as conn:
        records = await conn.fetch(query, user_id, lng, lat, RADIUS_METERS)
        return [HistoryRecord(**dict(r)) for r in records]

async def fetch_exclusion_zones(
    pool,
    user_id: str,
    lat: float,
    lng: float,
) -> List[ExclusionZone]:
    disliked_query = """
        SELECT
            ST_Y(location::geometry) AS latitude,
            ST_X(location::geometry) AS longitude,
            avoidance_radius_meters,
            coverage_type,
            COALESCE(ST_AsGeoJSON(street_geometry), '') AS geometry_json,
            COALESCE(ST_AsGeoJSON(drawn_geometry), '') AS polygon_json
        FROM disliked_areas
        WHERE user_id = $1
          AND (
              ST_DWithin(
                  location,
                  ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                  $4
              )
              OR (
                  street_geometry IS NOT NULL
                  AND ST_DWithin(
                      street_geometry,
                      ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                      $4
                  )
              )
              OR (
                  drawn_geometry IS NOT NULL
                  AND ST_DWithin(
                      drawn_geometry,
                      ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                      $4
                  )
              )
          )
    """
    events_query = """
        SELECT
            ST_Y(location::geometry) AS latitude,
            ST_X(location::geometry) AS longitude,
            CASE
                WHEN event_type = 'accident' THEN 200.0
                WHEN event_type = 'pothole' THEN 100.0
                ELSE 120.0
            END::double precision AS radius_meters,
            'area'::text AS coverage_type
        FROM events
        WHERE event_type IN ('pothole', 'accident', 'police')
          AND expires_at > NOW()
          AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              $3
          )
    """
    async with pool.acquire() as conn:
        disliked_records = await conn.fetch(
            disliked_query,
            user_id,
            lng,
            lat,
            EXCLUSION_SEARCH_RADIUS_METERS,
        )
        event_records = await conn.fetch(
            events_query,
            lng,
            lat,
            EXCLUSION_SEARCH_RADIUS_METERS,
        )

    zones = []
    for record in disliked_records:
        values = dict(record)
        geometry_json = values.pop("geometry_json", "")
        polygon_json = values.pop("polygon_json", "")
        paths = []
        polygon = []
        if geometry_json:
            geometry = json.loads(geometry_json)
            if geometry.get("type") == "MultiLineString":
                paths = [
                    [(float(point[1]), float(point[0])) for point in line]
                    for line in geometry.get("coordinates", [])
                    if len(line) >= 2
                ]
        if polygon_json:
            geometry = json.loads(polygon_json)
            if geometry.get("type") == "Polygon":
                rings = geometry.get("coordinates", [])
                if rings:
                    polygon = [
                        (float(point[1]), float(point[0]))
                        for point in rings[0]
                        if len(point) >= 2
                    ]
                    if len(polygon) > 1 and polygon[0] == polygon[-1]:
                        polygon.pop()
        zones.append(ExclusionZone(**values, paths=paths, polygon=polygon))

    zones.extend(ExclusionZone(**dict(record)) for record in event_records)
    return zones
