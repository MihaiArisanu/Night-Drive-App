from __future__ import annotations

import asyncio
import os
from math import cos, radians
from time import monotonic
from typing import Any, Dict, Iterable, Optional, Protocol

from road_network import ROAD_COST_FACTORS, RoadNetwork


DEFAULT_OVERPASS_URLS = (
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
DEFAULT_SEARCH_RADIUS_METERS = 7_000
CACHE_TTL_SECONDS = 10 * 60
GRID_SIZE_DEGREES = 0.02
RESTRICTED_ACCESS = {"no", "private", "destination", "customers", "delivery"}
CORE_ROAD_CLASSES = tuple(
    road_class
    for road_class in ROAD_COST_FACTORS
    if road_class not in {"tertiary", "tertiary_link"}
)


class RoadNetworkProviderError(RuntimeError):
    pass


class RoadNetworkPayloadCache(Protocol):
    async def get(self, key: str) -> Optional[list[Dict[str, Any]]]: ...

    async def set(self, key: str, elements: list[Dict[str, Any]]) -> None: ...


class OverpassRoadNetworkProvider:
    """Translates Overpass data into the road graph used by the domain planner."""

    def __init__(
        self,
        url: str | None = None,
        radius_meters: int = DEFAULT_SEARCH_RADIUS_METERS,
        timeout_seconds: float = 20.0,
        persistent_cache: RoadNetworkPayloadCache | None = None,
    ) -> None:
        configured_urls = os.getenv("OVERPASS_URLS", "")
        if url:
            self.urls = (url,)
        elif configured_urls:
            self.urls = tuple(
                configured_url.strip()
                for configured_url in configured_urls.split(",")
                if configured_url.strip()
            )
        else:
            self.urls = DEFAULT_OVERPASS_URLS
        self.radius_meters = radius_meters
        self.timeout_seconds = timeout_seconds
        self.persistent_cache = persistent_cache
        self._cache: Dict[str, tuple[float, RoadNetwork]] = {}

    async def fetch(
        self,
        latitude: float,
        longitude: float,
        *,
        include_tertiary: bool = True,
    ) -> RoadNetwork:
        import httpx

        center_latitude = round(latitude / GRID_SIZE_DEGREES) * GRID_SIZE_DEGREES
        center_longitude = round(longitude / GRID_SIZE_DEGREES) * GRID_SIZE_DEGREES
        network_tier = "extended" if include_tertiary else "core"
        cache_key = (
            f"zen:road-network:v3:{network_tier}:{center_latitude:.2f}:"
            f"{center_longitude:.2f}:{self.radius_meters}"
        )
        cached = self._cache.get(cache_key)
        if cached and cached[0] > monotonic():
            return cached[1]

        if self.persistent_cache:
            elements = await self.persistent_cache.get(cache_key)
            if elements:
                network = build_road_network(elements)
                if any(network.adjacency.values()):
                    self._cache[cache_key] = (
                        monotonic() + CACHE_TTL_SECONDS,
                        network,
                    )
                    return network

        query = self._query(
            center_latitude,
            center_longitude,
            include_tertiary=include_tertiary,
        )
        requests = [
            asyncio.create_task(
                asyncio.to_thread(
                    self._fetch_from_url,
                    url,
                    query,
                    self.timeout_seconds,
                )
            )
            for url in self.urls
        ]
        try:
            for completed in asyncio.as_completed(requests):
                try:
                    payload = await completed
                    elements = payload.get("elements")
                    if not isinstance(elements, list):
                        continue

                    network = build_road_network(elements)
                    if not any(network.adjacency.values()):
                        continue

                    self._cache[cache_key] = (
                        monotonic() + CACHE_TTL_SECONDS,
                        network,
                    )
                    if self.persistent_cache:
                        await self.persistent_cache.set(cache_key, elements)
                    return network
                except (httpx.HTTPError, ValueError):
                    continue
        finally:
            for request in requests:
                if not request.done():
                    request.cancel()
            await asyncio.gather(*requests, return_exceptions=True)

        raise RoadNetworkProviderError("All Overpass road network providers failed")

    @staticmethod
    def _fetch_from_url(
        url: str,
        query: str,
        timeout_seconds: float,
    ) -> Dict[str, Any]:
        import httpx

        with httpx.Client(
            timeout=timeout_seconds,
            headers={"User-Agent": "NightDrive-ZenEngine/1.0"},
        ) as client:
            response = client.post(url, data={"data": query})
            response.raise_for_status()
            return response.json()

    def _query(
        self,
        latitude: float,
        longitude: float,
        *,
        include_tertiary: bool = True,
    ) -> str:
        road_classes = "|".join(
            ROAD_COST_FACTORS.keys() if include_tertiary else CORE_ROAD_CLASSES
        )
        latitude_delta = self.radius_meters / 111_320.0
        longitude_scale = max(0.2, cos(radians(latitude)))
        longitude_delta = self.radius_meters / (111_320.0 * longitude_scale)
        south = latitude - latitude_delta
        west = longitude - longitude_delta
        north = latitude + latitude_delta
        east = longitude + longitude_delta
        return f"""
        [out:json][timeout:12];
        way({south},{west},{north},{east})
          [highway~"^({road_classes})$"];
        out tags geom({south},{west},{north},{east}) qt;
        """


def build_road_network(elements: Iterable[Dict[str, Any]]) -> RoadNetwork:
    elements = list(elements)
    raw_nodes = {
        int(element["id"]): (float(element["lat"]), float(element["lon"]))
        for element in elements
        if element.get("type") == "node"
        and "id" in element
        and "lat" in element
        and "lon" in element
    }
    network = RoadNetwork()
    synthetic_node_ids: Dict[tuple[float, float], int] = {}
    next_synthetic_id = -1

    for element in elements:
        if element.get("type") != "way":
            continue

        tags = element.get("tags") or {}
        road_class = tags.get("highway")
        if road_class not in ROAD_COST_FACTORS or _is_restricted(tags):
            continue

        geometry = element.get("geometry") or []
        raw_way_node_ids = element.get("nodes") or []
        node_segments = []
        current_segment = []

        if raw_way_node_ids and len(raw_way_node_ids) == len(geometry):
            for raw_node_id, point in zip(raw_way_node_ids, geometry):
                if point is None:
                    if len(current_segment) >= 2:
                        node_segments.append(current_segment)
                    current_segment = []
                    continue
                node_id = int(raw_node_id)
                coordinate = (float(point["lat"]), float(point["lon"]))
                raw_nodes[node_id] = coordinate
                current_segment.append(node_id)
        elif geometry:
            for point in geometry:
                if point is None:
                    if len(current_segment) >= 2:
                        node_segments.append(current_segment)
                    current_segment = []
                    continue
                coordinate = (float(point["lat"]), float(point["lon"]))
                coordinate_key = (round(coordinate[0], 7), round(coordinate[1], 7))
                node_id = synthetic_node_ids.get(coordinate_key)
                if node_id is None:
                    node_id = next_synthetic_id
                    next_synthetic_id -= 1
                    synthetic_node_ids[coordinate_key] = node_id
                raw_nodes[node_id] = coordinate
                current_segment.append(node_id)
        else:
            current_segment = [
                int(node_id)
                for node_id in raw_way_node_ids
                if int(node_id) in raw_nodes
            ]
        if len(current_segment) >= 2:
            node_segments.append(current_segment)
        if not node_segments:
            continue

        for node_ids in node_segments:
            for node_id in node_ids:
                network.nodes[node_id] = raw_nodes[node_id]

        oneway = str(tags.get("oneway", "")).lower()
        is_roundabout = tags.get("junction") == "roundabout"
        forward_only = oneway in {"yes", "true", "1"} or is_roundabout
        reverse_only = oneway == "-1"

        for node_ids in node_segments:
            for source, target in zip(node_ids, node_ids[1:]):
                if not reverse_only:
                    network.add_edge(source, target, road_class)
                if not forward_only:
                    network.add_edge(target, source, road_class)

    return network


def _is_restricted(tags: Dict[str, Any]) -> bool:
    return any(
        str(tags.get(key, "")).lower() in RESTRICTED_ACCESS
        for key in ("access", "vehicle", "motor_vehicle", "motorcar")
    )
