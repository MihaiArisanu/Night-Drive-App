import math
import random
from typing import List
from shapely.geometry import Point

EXCLUSION_BUFFER_DEG = 0.0027

def sort_waypoints_clockwise(center_lat: float, center_lng: float, points: List[tuple]) -> List[tuple]:
    def angle_from_center(pt):
        return math.atan2(pt[0] - center_lat, pt[1] - center_lng)
    return sorted(points, key=angle_from_center, reverse=True)

def generate_cold_start_loop(lat: float, lng: float, radius: float = 0.05) -> List[tuple]:
    base = random.uniform(0, 360)
    angles = [base, base + 120, base + 240]
    waypoints = []
    for angle in angles:
        rad = math.radians(angle)
        r = radius * random.uniform(0.8, 1.2)
        waypoints.append((lat + (r * math.cos(rad)), lng + (r * math.sin(rad))))
    return waypoints

def generate_forward_path(lat: float, lng: float, radius: float = 0.04, heading: float = 0.0) -> List[tuple]:
    base_math = 90.0 - heading

    offsets = [-85, -28, 28, 85]
    random.shuffle(offsets)
    waypoints = []
    for offset in offsets:
        angle_math = math.radians(base_math + offset)
        r = radius * random.uniform(0.7, 1.3)
        waypoints.append((lat + (r * math.cos(angle_math)), lng + (r * math.sin(angle_math))))
    return waypoints

def sort_as_path(origin_lat: float, origin_lng: float, points: List[tuple]) -> List[tuple]:
    remaining = list(points)
    ordered = []
    current = (origin_lat, origin_lng)
    while remaining:
        nearest = min(remaining, key=lambda p: math.hypot(p[0] - current[0], p[1] - current[1]))
        ordered.append(nearest)
        remaining.remove(nearest)
        current = nearest
    return ordered

def filter_waypoints(waypoints: List[tuple], bad_records: List[dict]) -> List[tuple]:
    exclusion_zones = [
        Point(r['latitude'], r['longitude']).buffer(EXCLUSION_BUFFER_DEG)
        for r in bad_records
    ]
    valid = []
    for lat, lng in waypoints:
        pt = Point(lat, lng)
        if not any(zone.contains(pt) for zone in exclusion_zones):
            valid.append((lat, lng))
    return valid