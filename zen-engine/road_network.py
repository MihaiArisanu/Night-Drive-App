from __future__ import annotations

from dataclasses import dataclass, field
from heapq import heappop, heappush
from math import atan2, cos, radians, sin, sqrt
from typing import Dict, List, Optional, Tuple


Coordinate = Tuple[float, float]
EARTH_RADIUS_METERS = 6_371_000.0
MAXIMUM_PARALLEL_ANGLE_DEGREES = 35.0


@dataclass(frozen=True)
class AvoidanceGeometry:
    center: Coordinate
    radius_meters: float
    paths: Tuple[Tuple[Coordinate, ...], ...] = ()

# Lower values make the planner prefer higher-capacity roads while still
# allowing links and tertiary roads when they are needed for connectivity.
ROAD_COST_FACTORS = {
    "motorway": 0.72,
    "trunk": 0.76,
    "primary": 0.82,
    "secondary": 0.92,
    "tertiary": 1.00,
    "motorway_link": 0.90,
    "trunk_link": 0.92,
    "primary_link": 0.96,
    "secondary_link": 1.02,
    "tertiary_link": 1.08,
}

ROAD_QUALITY = {
    "motorway": 1.00,
    "trunk": 0.96,
    "primary": 0.90,
    "secondary": 0.78,
    "tertiary": 0.66,
    "motorway_link": 0.80,
    "trunk_link": 0.78,
    "primary_link": 0.74,
    "secondary_link": 0.68,
    "tertiary_link": 0.60,
}


def haversine_meters(first: Coordinate, second: Coordinate) -> float:
    lat1, lng1 = first
    lat2, lng2 = second
    lat1_rad = radians(lat1)
    lat2_rad = radians(lat2)
    delta_lat = radians(lat2 - lat1)
    delta_lng = radians(lng2 - lng1)

    value = (
        sin(delta_lat / 2.0) ** 2
        + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lng / 2.0) ** 2
    )
    return EARTH_RADIUS_METERS * 2.0 * atan2(sqrt(value), sqrt(1.0 - value))


def bearing_degrees(first: Coordinate, second: Coordinate) -> float:
    lat1, lng1 = map(radians, first)
    lat2, lng2 = map(radians, second)
    delta_lng = lng2 - lng1

    y = sin(delta_lng) * cos(lat2)
    x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(delta_lng)
    return (atan2(y, x) * 180.0 / 3.141592653589793 + 360.0) % 360.0


def angular_difference(first: float, second: float) -> float:
    return abs((first - second + 180.0) % 360.0 - 180.0)


@dataclass(frozen=True)
class RoadEdge:
    target: int
    distance_meters: float
    road_class: str


@dataclass
class RoadNetwork:
    nodes: Dict[int, Coordinate] = field(default_factory=dict)
    adjacency: Dict[int, List[RoadEdge]] = field(default_factory=dict)

    def add_edge(self, source: int, target: int, road_class: str) -> None:
        if source not in self.nodes or target not in self.nodes:
            return

        distance = haversine_meters(self.nodes[source], self.nodes[target])
        if distance <= 0.0:
            return

        self.adjacency.setdefault(source, []).append(
            RoadEdge(
                target=target,
                distance_meters=distance,
                road_class=road_class,
            )
        )
        self.adjacency.setdefault(target, [])


@dataclass(frozen=True)
class RoadPathPlannerConfig:
    waypoint_count: int = 4
    waypoint_interval_meters: float = 1_000.0
    continuation_reserve_meters: float = 2_500.0
    max_snap_distance_meters: float = 3_500.0
    max_path_distance_meters: float = 11_000.0
    max_access_candidates: int = 12

    @property
    def waypoint_path_distance_meters(self) -> float:
        return self.waypoint_count * self.waypoint_interval_meters

    @property
    def required_path_distance_meters(self) -> float:
        return self.waypoint_path_distance_meters + self.continuation_reserve_meters


class RoadPathPlanner:
    """Selects ordered waypoints from one connected, drivable road corridor."""

    def __init__(self, config: Optional[RoadPathPlannerConfig] = None) -> None:
        self.config = config or RoadPathPlannerConfig()

    def plan(
        self,
        network: RoadNetwork,
        origin: Coordinate,
        heading: float,
        avoidance_zones: Optional[List[AvoidanceGeometry]] = None,
    ) -> List[Coordinate]:
        best_waypoints: List[Coordinate] = []
        best_score = float("-inf")
        effective_zones = [
            zone
            for zone in (avoidance_zones or [])
            if zone.radius_meters > 0.0
            and (
                bool(zone.paths)
                or haversine_meters(origin, zone.center) > zone.radius_meters
            )
        ]

        for start, access_distance in self._candidate_start_nodes(
            network,
            origin,
            effective_zones,
        ):
            waypoints, corridor_score = self._plan_from_start(
                network=network,
                start=start,
                heading=heading,
                avoidance_zones=effective_zones,
            )
            if not waypoints:
                continue

            # Prefer a nearby entry point, but never choose a short dead-end
            # component merely because it is closest to the parked vehicle.
            access_penalty = access_distance / 1_000.0 * 0.75
            total_score = corridor_score - access_penalty
            if total_score > best_score:
                best_score = total_score
                best_waypoints = waypoints

        return best_waypoints

    def _plan_from_start(
        self,
        network: RoadNetwork,
        start: int,
        heading: float,
        avoidance_zones: List[AvoidanceGeometry],
    ) -> Tuple[List[Coordinate], float]:

        parents: Dict[int, Optional[int]] = {start: None}
        best_cost: Dict[int, float] = {start: 0.0}
        travelled: Dict[int, float] = {start: 0.0}
        first_bearings: Dict[int, float] = {}
        quality_sums: Dict[int, float] = {start: 0.0}
        queue: List[Tuple[float, int]] = [(0.0, start)]

        while queue:
            current_cost, current = heappop(queue)
            if current_cost > best_cost.get(current, float("inf")):
                continue

            current_distance = travelled[current]
            for edge in network.adjacency.get(current, []):
                if self._segment_is_blocked(
                    network.nodes[current],
                    network.nodes[edge.target],
                    avoidance_zones,
                ):
                    continue
                next_distance = current_distance + edge.distance_meters
                if next_distance > self.config.max_path_distance_meters:
                    continue

                edge_bearing = bearing_degrees(
                    network.nodes[current],
                    network.nodes[edge.target],
                )
                first_bearing = first_bearings.get(current, edge_bearing)
                heading_penalty = 0.0
                if current == start:
                    # Reverse remains possible if it is the only connected
                    # option, but loses against a road that continues ahead.
                    heading_penalty = angular_difference(first_bearing, heading) * 12.0

                road_factor = ROAD_COST_FACTORS.get(edge.road_class, 1.20)
                next_cost = current_cost + edge.distance_meters * road_factor + heading_penalty

                if next_cost >= best_cost.get(edge.target, float("inf")):
                    continue

                best_cost[edge.target] = next_cost
                travelled[edge.target] = next_distance
                parents[edge.target] = current
                first_bearings[edge.target] = first_bearing
                quality_sums[edge.target] = (
                    quality_sums[current]
                    + edge.distance_meters * ROAD_QUALITY.get(edge.road_class, 0.50)
                )
                heappush(queue, (next_cost, edge.target))

        candidate = self._best_candidate(
            network=network,
            start=start,
            heading=heading,
            travelled=travelled,
            first_bearings=first_bearings,
            quality_sums=quality_sums,
        )
        if candidate is None:
            return [], float("-inf")

        target, score = candidate
        path = self._reconstruct_path(parents, target)
        return self._sample_waypoints(network, path), score

    def _candidate_start_nodes(
        self,
        network: RoadNetwork,
        origin: Coordinate,
        avoidance_zones: List[AvoidanceGeometry],
    ) -> List[Tuple[int, float]]:
        candidates = [
            (node_id, haversine_meters(origin, network.nodes[node_id]))
            for node_id, edges in network.adjacency.items()
            if edges
            and not any(
                point_is_blocked(network.nodes[node_id], zone)
                for zone in avoidance_zones
            )
        ]
        candidates = [
            candidate
            for candidate in candidates
            if candidate[1] <= self.config.max_snap_distance_meters
        ]
        candidates.sort(key=lambda candidate: candidate[1])
        return candidates[: self.config.max_access_candidates]

    @staticmethod
    def _segment_is_blocked(
        start: Coordinate,
        end: Coordinate,
        avoidance_zones: List[AvoidanceGeometry],
    ) -> bool:
        return any(
            segment_is_blocked(start, end, zone)
            for zone in avoidance_zones
        )

    def _best_candidate(
        self,
        network: RoadNetwork,
        start: int,
        heading: float,
        travelled: Dict[int, float],
        first_bearings: Dict[int, float],
        quality_sums: Dict[int, float],
    ) -> Optional[Tuple[int, float]]:
        required_distance = self.config.required_path_distance_meters
        candidates = [
            node_id
            for node_id, distance in travelled.items()
            if required_distance <= distance <= self.config.max_path_distance_meters
        ]
        if not candidates:
            return None

        start_coordinate = network.nodes[start]

        def score(node_id: int) -> float:
            path_distance = travelled[node_id]
            first_bearing = first_bearings[node_id]
            alignment = 1.0 - angular_difference(first_bearing, heading) / 180.0
            average_quality = quality_sums[node_id] / path_distance
            directness = min(
                1.0,
                haversine_meters(start_coordinate, network.nodes[node_id]) / path_distance,
            )
            distance_fit = max(
                0.0,
                1.0
                - (path_distance - required_distance)
                / max(1.0, self.config.max_path_distance_meters - required_distance),
            )
            return alignment * 5.0 + average_quality * 2.0 + directness + distance_fit

        target = max(candidates, key=score)
        return target, score(target)

    @staticmethod
    def _reconstruct_path(parents: Dict[int, Optional[int]], target: int) -> List[int]:
        path: List[int] = []
        current: Optional[int] = target
        while current is not None:
            path.append(current)
            current = parents[current]
        path.reverse()
        return path

    def _sample_waypoints(
        self,
        network: RoadNetwork,
        path: List[int],
    ) -> List[Coordinate]:
        if len(path) < 2:
            return []

        targets = [
            self.config.waypoint_interval_meters * index
            for index in range(1, self.config.waypoint_count + 1)
        ]
        waypoints: List[Coordinate] = []
        target_index = 0
        travelled = 0.0

        for source_id, target_id in zip(path, path[1:]):
            source = network.nodes[source_id]
            target = network.nodes[target_id]
            segment_distance = haversine_meters(source, target)
            if segment_distance <= 0.0:
                continue

            while (
                target_index < len(targets)
                and travelled + segment_distance >= targets[target_index]
            ):
                offset = targets[target_index] - travelled
                fraction = min(1.0, max(0.0, offset / segment_distance))
                waypoints.append(
                    (
                        source[0] + (target[0] - source[0]) * fraction,
                        source[1] + (target[1] - source[1]) * fraction,
                    )
                )
                target_index += 1

            travelled += segment_distance
            if target_index == len(targets):
                break

        if len(waypoints) != self.config.waypoint_count:
            return []
        return waypoints


def distance_point_to_segment_meters(
    point: Coordinate,
    start: Coordinate,
    end: Coordinate,
) -> float:
    """Return the local metric distance from a point to a road segment."""
    latitude_radians = radians(point[0])

    def project(coordinate: Coordinate) -> Tuple[float, float]:
        return (
            radians(coordinate[1] - point[1])
            * EARTH_RADIUS_METERS
            * max(0.1, cos(latitude_radians)),
            radians(coordinate[0] - point[0]) * EARTH_RADIUS_METERS,
        )

    start_x, start_y = project(start)
    end_x, end_y = project(end)
    delta_x = end_x - start_x
    delta_y = end_y - start_y
    length_squared = delta_x * delta_x + delta_y * delta_y
    if length_squared == 0.0:
        return math_hypot(start_x, start_y)

    projection = -(start_x * delta_x + start_y * delta_y) / length_squared
    projection = min(1.0, max(0.0, projection))
    closest_x = start_x + projection * delta_x
    closest_y = start_y + projection * delta_y
    return math_hypot(closest_x, closest_y)


def distance_point_to_path_meters(
    point: Coordinate,
    paths,
) -> float:
    minimum = float("inf")
    for path in paths:
        for start, end in zip(path, path[1:]):
            minimum = min(
                minimum,
                distance_point_to_segment_meters(point, start, end),
            )
    return minimum


def point_is_blocked(point: Coordinate, zone: AvoidanceGeometry) -> bool:
    if zone.paths:
        return distance_point_to_path_meters(point, zone.paths) <= zone.radius_meters
    return haversine_meters(point, zone.center) <= zone.radius_meters


def segment_is_blocked(
    start: Coordinate,
    end: Coordinate,
    zone: AvoidanceGeometry,
) -> bool:
    if not zone.paths:
        return (
            distance_point_to_segment_meters(zone.center, start, end)
            <= zone.radius_meters
        )

    edge_bearing = bearing_degrees(start, end)
    for path in zone.paths:
        for street_start, street_end in zip(path, path[1:]):
            if (
                distance_segment_to_segment_meters(
                    start,
                    end,
                    street_start,
                    street_end,
                )
                > zone.radius_meters
            ):
                continue
            if (
                parallel_angle_difference(
                    edge_bearing,
                    bearing_degrees(street_start, street_end),
                )
                <= MAXIMUM_PARALLEL_ANGLE_DEGREES
            ):
                return True
    return False


def parallel_angle_difference(first: float, second: float) -> float:
    difference = abs((first - second + 180.0) % 360.0 - 180.0)
    return 180.0 - difference if difference > 90.0 else difference


def distance_segment_to_segment_meters(
    first_start: Coordinate,
    first_end: Coordinate,
    second_start: Coordinate,
    second_end: Coordinate,
) -> float:
    points = [
        _project_local(coordinate, first_start)
        for coordinate in (first_start, first_end, second_start, second_end)
    ]
    first_start_xy, first_end_xy, second_start_xy, second_end_xy = points
    if _segments_intersect(
        first_start_xy,
        first_end_xy,
        second_start_xy,
        second_end_xy,
    ):
        return 0.0
    return min(
        _distance_cartesian_point_to_segment(
            first_start_xy,
            second_start_xy,
            second_end_xy,
        ),
        _distance_cartesian_point_to_segment(
            first_end_xy,
            second_start_xy,
            second_end_xy,
        ),
        _distance_cartesian_point_to_segment(
            second_start_xy,
            first_start_xy,
            first_end_xy,
        ),
        _distance_cartesian_point_to_segment(
            second_end_xy,
            first_start_xy,
            first_end_xy,
        ),
    )


def _project_local(
    coordinate: Coordinate,
    origin: Coordinate,
) -> Tuple[float, float]:
    return (
        radians(coordinate[1] - origin[1])
        * EARTH_RADIUS_METERS
        * max(0.1, cos(radians(origin[0]))),
        radians(coordinate[0] - origin[0]) * EARTH_RADIUS_METERS,
    )


def _segments_intersect(first_start, first_end, second_start, second_end) -> bool:
    epsilon = 0.000001

    def orientation(first, second, third):
        return (
            (second[0] - first[0]) * (third[1] - first[1])
            - (second[1] - first[1]) * (third[0] - first[0])
        )

    def on_segment(first, middle, last):
        return (
            min(first[0], last[0]) - epsilon
            <= middle[0]
            <= max(first[0], last[0]) + epsilon
            and min(first[1], last[1]) - epsilon
            <= middle[1]
            <= max(first[1], last[1]) + epsilon
        )

    first = orientation(first_start, first_end, second_start)
    second = orientation(first_start, first_end, second_end)
    third = orientation(second_start, second_end, first_start)
    fourth = orientation(second_start, second_end, first_end)
    if first * second < 0.0 and third * fourth < 0.0:
        return True
    return (
        (abs(first) <= epsilon and on_segment(first_start, second_start, first_end))
        or (abs(second) <= epsilon and on_segment(first_start, second_end, first_end))
        or (abs(third) <= epsilon and on_segment(second_start, first_start, second_end))
        or (abs(fourth) <= epsilon and on_segment(second_start, first_end, second_end))
    )


def _distance_cartesian_point_to_segment(point, start, end) -> float:
    delta_x = end[0] - start[0]
    delta_y = end[1] - start[1]
    length_squared = delta_x * delta_x + delta_y * delta_y
    if length_squared == 0.0:
        return math_hypot(point[0] - start[0], point[1] - start[1])
    projection = (
        (point[0] - start[0]) * delta_x
        + (point[1] - start[1]) * delta_y
    ) / length_squared
    projection = min(1.0, max(0.0, projection))
    closest = (
        start[0] + projection * delta_x,
        start[1] + projection * delta_y,
    )
    return math_hypot(point[0] - closest[0], point[1] - closest[1])


def math_hypot(x: float, y: float) -> float:
    return sqrt(x * x + y * y)
