import os
import asyncpg
from typing import List

from models import HistoryRecord, ExclusionZone

DATABASE_URL = os.getenv("DATABASE_URL")

RADIUS_METERS = 10000  

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

async def fetch_exclusion_zones(pool, user_id: str) -> List[ExclusionZone]:
    query = """
        SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM disliked_areas WHERE user_id = $1
        UNION ALL
        SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM events WHERE event_type IN ('pothole', 'accident', 'police')
    """
    async with pool.acquire() as conn:
        records = await conn.fetch(query, user_id)
        return [ExclusionZone(**dict(r)) for r in records]