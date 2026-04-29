import math
import random
import httpx
from typing import List, Tuple
from shapely.geometry import Point

from models import ExclusionZone

EXCLUSION_BUFFER_DEG = 0.0027

def sort_waypoints_clockwise(center_lat: float, center_lng: float, points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    def angle_from_center(pt):
        return math.atan2(pt[0] - center_lat, pt[1] - center_lng)
    return sorted(points, key=angle_from_center, reverse=True)

def generate_cold_start_loop(lat: float, lng: float, radius: float = 0.05) -> List[Tuple[float, float]]:
    base = random.uniform(0, 360)
    angles = [base, base + 120, base + 240]
    waypoints = []
    for angle in angles:
        rad = math.radians(angle)
        r = radius * random.uniform(0.8, 1.2)
        waypoints.append((lat + (r * math.cos(rad)), lng + (r * math.sin(rad))))
    return waypoints

def generate_forward_path_fallback(lat: float, lng: float, radius: float = 0.04, heading: float = 0.0) -> List[Tuple[float, float]]:
    base_math = 90.0 - heading
    offsets = [-85, -28, 28, 85]
    random.shuffle(offsets)
    waypoints = []
    for offset in offsets:
        angle_math = math.radians(base_math + offset)
        r = radius * random.uniform(0.7, 1.3)
        waypoints.append((lat + (r * math.cos(angle_math)), lng + (r * math.sin(angle_math))))
    return waypoints

async def generate_forward_path_async(lat: float, lng: float, heading: float = 0.0) -> List[Tuple[float, float]]:
    radius_m = 5000
    query = f"""
    [out:json];
    way(around:{radius_m},{lat},{lng})[highway~"primary|secondary|tertiary"];
    node(w);
    out skel;
    """
    url = "https://overpass-api.de/api/interpreter"
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, data={"data": query}, timeout=5.0)
            
        if resp.status_code != 200:
            print(f"Overpass API returned {resp.status_code}. Using fallback.")
            return generate_forward_path_fallback(lat, lng, radius=0.04, heading=heading)
            
        data = resp.json()
        elements = data.get("elements", [])
        
        if len(elements) < 4:
            return generate_forward_path_fallback(lat, lng, radius=0.04, heading=heading)
            
        base_math = 90.0 - heading
        target_angles = [math.radians(base_math + offset) for offset in [-45, 0, 45]]
        
        valid_nodes = []
        for el in elements:
            node_lat = el["lat"]
            node_lng = el["lon"]
            
            angle = math.atan2(node_lat - lat, node_lng - lng)
            
            for target in target_angles:
                diff = math.atan2(math.sin(angle - target), math.cos(angle - target))
                if abs(diff) < math.radians(30):
                    valid_nodes.append((node_lat, node_lng))
                    break
                    
        if len(valid_nodes) < 4:
            random.shuffle(elements)
            valid_nodes = [(el["lat"], el["lon"]) for el in elements[:4]]
            
        random.shuffle(valid_nodes)
        return valid_nodes[:4]
            
    except Exception as e:
        print(f"Overpass API error: {e}. Using fallback.")
        return generate_forward_path_fallback(lat, lng, radius=0.04, heading=heading)

def sort_as_path(origin_lat: float, origin_lng: float, points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    remaining = list(points)
    ordered = []
    current = (origin_lat, origin_lng)
    while remaining:
        nearest = min(remaining, key=lambda p: math.hypot(p[0] - current[0], p[1] - current[1]))
        ordered.append(nearest)
        remaining.remove(nearest)
        current = nearest
    return ordered

def filter_waypoints(waypoints: List[Tuple[float, float]], bad_records: List[ExclusionZone]) -> List[Tuple[float, float]]:
    exclusion_zones = [
        Point(r.latitude, r.longitude).buffer(EXCLUSION_BUFFER_DEG)
        for r in bad_records
    ]
    valid = []
    for lat, lng in waypoints:
        pt = Point(lat, lng)
        if not any(zone.contains(pt) for zone in exclusion_zones):
            valid.append((lat, lng))
    return valid