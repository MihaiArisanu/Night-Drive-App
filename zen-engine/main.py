import os
from typing import List
from fastapi import FastAPI, Depends, HTTPException, Header

import database
import ml_engine
import geo_utils

app = FastAPI(title="The Zen Engine", version="1.1")

from pydantic import BaseModel

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
        print("EROARE CRITICĂ: INTERNAL_SECRET nu este setat în .env!")
        return 

    if x_internal_secret != expected_secret:
        raise HTTPException(
            status_code=403, 
            detail="Forbidden: Accesul neautorizat. Secret invalid."
        )

@app.on_event("startup")
async def startup():
    app.state.pool = await database.get_db_pool()

@app.on_event("shutdown")
async def shutdown():
    await app.state.pool.close()

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
    bad_areas = await database.fetch_exclusion_zones(pool, payload.user_id)
    
    is_cold_start = False
    
    if len(history) < 50:
        is_cold_start = True
        waypoints_tuples = await geo_utils.generate_forward_path_async(payload.current_lat, payload.current_lng, heading=payload.heading)
    else:
        cluster_centroids = ml_engine.get_zen_clusters(history)
        valid_waypoints = geo_utils.filter_waypoints(cluster_centroids, bad_areas)
        
        if len(valid_waypoints) < 4:
            is_cold_start = True
            waypoints_tuples = await geo_utils.generate_forward_path_async(payload.current_lat, payload.current_lng, heading=payload.heading)
        else:
            waypoints_tuples = valid_waypoints[:4]
            
    ordered = geo_utils.sort_as_path(payload.current_lat, payload.current_lng, waypoints_tuples)
    
    return ZenResponse(
        waypoints=[Waypoint(lat=w[0], lng=w[1]) for w in ordered],
        is_cold_start=is_cold_start
    )