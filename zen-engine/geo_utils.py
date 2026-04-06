import math
from typing import List
from shapely.geometry import Point

EXCLUSION_BUFFER_DEG = 0.0027

def sort_waypoints_clockwise(center_lat: float, center_lng: float, points: List[tuple]) -> List[tuple]:
    def angle_from_center(pt):
        return math.atan2(pt[0] - center_lat, pt[1] - center_lng)
    return sorted(points, key=angle_from_center, reverse=True)

def generate_cold_start_loop(lat: float, lng: float, radius: float = 0.05) -> List[tuple]:
    angles = [0, 120, 240]
    waypoints = []
    for angle in angles:
        rad = math.radians(angle)
        waypoints.append((lat + (radius * math.cos(rad)), lng + (radius * math.sin(rad))))
    return waypoints

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