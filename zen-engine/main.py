import os
import asyncio
from typing import List
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Header
from pydantic import BaseModel

import database
import ml_engine
import geo_utils
from overpass_client import RoadNetworkProviderError

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await database.get_db_pool()
    yield
    await app.state.pool.close()

app = FastAPI(title="The Zen Engine", version="1.1", lifespan=lifespan)

class Waypoint(BaseModel):
    lat: float
    lng: float

class ZenRequest(BaseModel):
    user_id: str
    current_lat: float
    current_lng: float
    heading: float = 0.0

class ZenResponse(BaseModel):
    waypoints: List[Waypoint]
    is_cold_start: bool

async def verify_internal_secret(x_internal_secret: str = Header(None)):
    expected_secret = os.getenv("INTERNAL_SECRET")
    
    if not expected_secret:
        raise HTTPException(
            status_code=503,
            detail="Zen Engine internal authentication is not configured.",
        )

    if x_internal_secret != expected_secret:
        raise HTTPException(
            status_code=403, 
            detail="Forbidden: Unauthorized access. Invalid secret."
        )

@app.get("/health")
async def health_check():
    pool = app.state.pool
    try:
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database unavailable: {e}")

@app.post(
    "/generate-loop", 
    response_model=ZenResponse, 
    dependencies=[Depends(verify_internal_secret)]
)
async def generate_path(payload: ZenRequest):
    pool = app.state.pool
    
    history = await database.fetch_history(pool, payload.user_id, payload.current_lat, payload.current_lng)
    bad_areas = await database.fetch_exclusion_zones(
        pool,
        payload.user_id,
        payload.current_lat,
        payload.current_lng,
    )
    
    is_cold_start = False
    waypoints_are_ordered = False
    
    try:
        if len(history) < 50:
            is_cold_start = True
            waypoints_tuples = await geo_utils.generate_forward_path_async(
                payload.current_lat,
                payload.current_lng,
                heading=payload.heading,
                excluded_zones=bad_areas,
            )
            waypoints_are_ordered = True
        else:
            cluster_centroids = await asyncio.to_thread(ml_engine.get_zen_clusters, history)
            valid_waypoints = geo_utils.filter_waypoints(cluster_centroids, bad_areas)

            if len(valid_waypoints) < 4:
                is_cold_start = True
                waypoints_tuples = await geo_utils.generate_forward_path_async(
                    payload.current_lat,
                    payload.current_lng,
                    heading=payload.heading,
                    excluded_zones=bad_areas,
                )
                waypoints_are_ordered = True
            else:
                waypoints_tuples = valid_waypoints[:4]
    except RoadNetworkProviderError as error:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "road_data_unavailable",
                "message": "Road network data is temporarily unavailable.",
            },
        ) from error

    if not waypoints_tuples:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "no_connected_corridor",
                "message": "No connected main-road corridor is available nearby.",
            },
        )

    ordered = (
        waypoints_tuples
        if waypoints_are_ordered
        else geo_utils.sort_as_path(payload.current_lat, payload.current_lng, waypoints_tuples)
    )
    
    return ZenResponse(
        waypoints=[Waypoint(lat=w[0], lng=w[1]) for w in ordered],
        is_cold_start=is_cold_start
    )
