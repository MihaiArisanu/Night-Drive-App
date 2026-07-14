import asyncio
import unittest
from unittest.mock import patch

from overpass_client import OverpassRoadNetworkProvider, build_road_network

try:
    import httpx  # noqa: F401
except ModuleNotFoundError:
    httpx = None


class OverpassRoadNetworkTests(unittest.TestCase):
    def test_core_query_defers_tertiary_roads_to_the_fallback(self) -> None:
        provider = OverpassRoadNetworkProvider(radius_meters=1_000)

        core_query = provider._query(45.0, 24.0, include_tertiary=False)
        extended_query = provider._query(45.0, 24.0, include_tertiary=True)

        self.assertNotIn("|tertiary|", core_query)
        self.assertIn("|tertiary|", extended_query)

    def test_preserves_one_way_direction(self) -> None:
        network = build_road_network(
            [
                {"type": "node", "id": 1, "lat": 45.0, "lon": 24.0},
                {"type": "node", "id": 2, "lat": 45.01, "lon": 24.0},
                {
                    "type": "way",
                    "id": 10,
                    "nodes": [1, 2],
                    "tags": {"highway": "primary", "oneway": "yes"},
                },
            ]
        )

        self.assertEqual([edge.target for edge in network.adjacency[1]], [2])
        self.assertEqual(network.adjacency[2], [])

    def test_excludes_roads_that_forbid_through_traffic(self) -> None:
        network = build_road_network(
            [
                {"type": "node", "id": 1, "lat": 45.0, "lon": 24.0},
                {"type": "node", "id": 2, "lat": 45.01, "lon": 24.0},
                {
                    "type": "way",
                    "id": 10,
                    "nodes": [1, 2],
                    "tags": {"highway": "secondary", "access": "destination"},
                },
            ]
        )

        self.assertEqual(network.nodes, {})
        self.assertEqual(network.adjacency, {})

    def test_connects_geometry_only_ways_at_shared_coordinates(self) -> None:
        network = build_road_network(
            [
                {
                    "type": "way",
                    "id": 10,
                    "tags": {"highway": "primary"},
                    "geometry": [
                        {"lat": 45.0, "lon": 24.0},
                        {"lat": 45.01, "lon": 24.0},
                    ],
                },
                {
                    "type": "way",
                    "id": 11,
                    "tags": {"highway": "secondary"},
                    "geometry": [
                        {"lat": 45.01, "lon": 24.0},
                        {"lat": 45.01, "lon": 24.01},
                    ],
                },
            ]
        )

        shared_nodes = [
            node_id
            for node_id, coordinate in network.nodes.items()
            if coordinate == (45.01, 24.0)
        ]
        self.assertEqual(len(shared_nodes), 1)
        self.assertEqual(len(network.adjacency[shared_nodes[0]]), 2)

    def test_does_not_connect_across_clipped_geometry_gaps(self) -> None:
        network = build_road_network(
            [
                {
                    "type": "way",
                    "id": 10,
                    "tags": {"highway": "primary"},
                    "geometry": [
                        {"lat": 45.0, "lon": 24.0},
                        {"lat": 45.01, "lon": 24.0},
                        None,
                        {"lat": 45.03, "lon": 24.0},
                        {"lat": 45.04, "lon": 24.0},
                    ],
                }
            ]
        )

        self.assertEqual(sum(len(edges) for edges in network.adjacency.values()), 4)

    @unittest.skipIf(httpx is None, "httpx is installed inside the Zen container")
    def test_uses_the_first_healthy_provider_and_caches_the_network(self) -> None:
        provider = OverpassRoadNetworkProvider(
            radius_meters=1_000,
            timeout_seconds=1.0,
        )
        payload = {
            "elements": [
                {
                    "type": "way",
                    "id": 10,
                    "tags": {"highway": "primary"},
                    "geometry": [
                        {"lat": 45.0, "lon": 24.0},
                        {"lat": 45.01, "lon": 24.0},
                    ],
                }
            ]
        }

        with patch.object(
            provider,
            "_fetch_from_url",
            return_value=payload,
        ) as fetch_mock:
            first = asyncio.run(provider.fetch(45.0, 24.0))
            second = asyncio.run(provider.fetch(45.0, 24.0))

        self.assertIs(first, second)
        self.assertGreaterEqual(fetch_mock.call_count, 1)
        self.assertLessEqual(fetch_mock.call_count, len(provider.urls))


if __name__ == "__main__":
    unittest.main()
