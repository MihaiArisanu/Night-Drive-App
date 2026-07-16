import math
from typing import List, Tuple

from models import ExclusionZone
from overpass_client import OverpassRoadNetworkProvider
from road_network_cache import RedisRoadNetworkCache
from road_network import (
    AvoidanceGeometry,
    RoadPathPlanner,
    point_is_blocked,
)

road_network_provider = OverpassRoadNetworkProvider(
    persistent_cache=RedisRoadNetworkCache(),
)
road_path_planner = RoadPathPlanner()


async def generate_forward_path_async(
    lat: float,
    lng: float,
    heading: float = 0.0,
    excluded_zones: List[ExclusionZone] | None = None,
) -> List[Tuple[float, float]]:
    """Generate a forward route only when it can be verified on connected roads."""
    avoidance_zones = [
        AvoidanceGeometry(
            center=(zone.latitude, zone.longitude),
            radius_meters=zone.radius_meters,
            paths=tuple(tuple(path) for path in zone.paths),
            polygon=tuple(zone.polygon),
        )
        for zone in (excluded_zones or [])
    ]
    core_network = await road_network_provider.fetch(
        lat,
        lng,
        include_tertiary=False,
    )
    core_path = road_path_planner.plan(
        core_network,
        (lat, lng),
        heading,
        avoidance_zones=avoidance_zones,
    )
    if core_path:
        return core_path

    extended_network = await road_network_provider.fetch(
        lat,
        lng,
        include_tertiary=True,
    )
    return road_path_planner.plan(
        extended_network,
        (lat, lng),
        heading,
        avoidance_zones=avoidance_zones,
    )


def sort_as_path(
    origin_lat: float,
    origin_lng: float,
    points: List[Tuple[float, float]],
) -> List[Tuple[float, float]]:
    remaining = list(points)
    ordered = []
    current = (origin_lat, origin_lng)
    while remaining:
        nearest = min(
            remaining,
            key=lambda point: math.hypot(
                point[0] - current[0],
                point[1] - current[1],
            ),
        )
        ordered.append(nearest)
        remaining.remove(nearest)
        current = nearest
    return ordered


def filter_waypoints(
    waypoints: List[Tuple[float, float]],
    bad_records: List[ExclusionZone],
) -> List[Tuple[float, float]]:
    return [
        waypoint
        for waypoint in waypoints
        if not any(
            point_is_blocked(
                waypoint,
                AvoidanceGeometry(
                    center=(record.latitude, record.longitude),
                    radius_meters=record.radius_meters,
                    paths=tuple(tuple(path) for path in record.paths),
                    polygon=tuple(record.polygon),
                ),
            )
            for record in bad_records
        )
    ]
