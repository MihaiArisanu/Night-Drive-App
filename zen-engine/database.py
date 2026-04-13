import os
import asyncpg
from typing import List

DATABASE_URL = os.getenv("DATABASE_URL")

RADIUS_METERS = 10000  

async def get_db_pool():
    if not DATABASE_URL:
        raise ValueError("EROARE: DATABASE_URL nu este setată de Docker Compose!")
    return await asyncpg.create_pool(DATABASE_URL)

async def fetch_history(pool, user_id: str, lat: float, lng: float) -> List[dict]:
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
    try:
        async with pool.acquire() as conn:
            return await conn.fetch(query, user_id, lng, lat, RADIUS_METERS)
    except Exception as e:
        print(f"[Avertisment DB] Eroare la fetch_history: {e}")
        return [] 

async def fetch_exclusion_zones(pool, user_id: str) -> List[dict]:
    query = """
        SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM disliked_areas WHERE user_id = $1
        UNION ALL
        SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM events WHERE event_type IN ('pothole', 'accident', 'police')
    """
    try:
        async with pool.acquire() as conn:
            return await conn.fetch(query, user_id)
    except Exception as e:
        print(f"[Avertisment DB] Eroare la fetch_exclusion_zones: {e}")
        return []