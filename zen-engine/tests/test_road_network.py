import unittest

from road_network import (
    AvoidanceGeometry,
    RoadNetwork,
    RoadPathPlanner,
    RoadPathPlannerConfig,
    distance_point_to_segment_meters,
    haversine_meters,
    segment_is_blocked,
)


class RoadPathPlannerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = RoadPathPlannerConfig(
            waypoint_count=4,
            waypoint_interval_meters=1_000.0,
            continuation_reserve_meters=2_000.0,
            max_snap_distance_meters=1_000.0,
            max_path_distance_meters=10_000.0,
            max_access_candidates=12,
        )
        self.planner = RoadPathPlanner(self.config)

    def test_rejects_heading_aligned_dead_end_and_uses_connected_corridor(self) -> None:
        network = RoadNetwork(nodes={1: (0.0, 0.0)})

        # Short eastbound branch matches the heading but ends after ~2 km.
        self._add_bidirectional_chain(
            network,
            [(1, (0.0, 0.0)), (2, (0.0, 0.009)), (3, (0.0, 0.018))],
            "tertiary",
        )

        # Northbound primary road has enough distance for all waypoints plus
        # the continuation reserve.
        north_nodes = [(1, (0.0, 0.0))]
        north_nodes.extend(
            (node_id, ((node_id - 3) * 0.009, 0.0))
            for node_id in range(4, 12)
        )
        self._add_bidirectional_chain(network, north_nodes, "primary")

        waypoints = self.planner.plan(network, (0.0, 0.0), heading=90.0)

        self.assertEqual(len(waypoints), 4)
        self.assertTrue(all(latitude > 0.0 for latitude, _ in waypoints))
        self.assertTrue(all(abs(longitude) < 0.000001 for _, longitude in waypoints))

    def test_prefers_the_long_corridor_matching_the_vehicle_heading(self) -> None:
        network = RoadNetwork(nodes={1: (0.0, 0.0)})
        east_nodes = [(1, (0.0, 0.0))]
        east_nodes.extend(
            (node_id, (0.0, (node_id - 1) * 0.009))
            for node_id in range(2, 10)
        )
        north_nodes = [(1, (0.0, 0.0))]
        north_nodes.extend(
            (node_id, ((node_id - 9) * 0.009, 0.0))
            for node_id in range(10, 18)
        )
        self._add_bidirectional_chain(network, east_nodes, "primary")
        self._add_bidirectional_chain(network, north_nodes, "primary")

        waypoints = self.planner.plan(network, (0.0, 0.0), heading=90.0)

        self.assertEqual(len(waypoints), 4)
        self.assertTrue(all(longitude > 0.0 for _, longitude in waypoints))
        self.assertTrue(all(abs(latitude) < 0.000001 for latitude, _ in waypoints))

    def test_samples_ordered_waypoints_and_keeps_a_continuation_reserve(self) -> None:
        network = RoadNetwork(nodes={1: (0.0, 0.0)})
        road_nodes = [(1, (0.0, 0.0))]
        road_nodes.extend(
            (node_id, ((node_id - 1) * 0.009, 0.0))
            for node_id in range(2, 10)
        )
        self._add_bidirectional_chain(network, road_nodes, "secondary")

        waypoints = self.planner.plan(network, (0.0, 0.0), heading=0.0)

        self.assertEqual(len(waypoints), 4)
        distances = [haversine_meters((0.0, 0.0), waypoint) for waypoint in waypoints]
        self.assertEqual(distances, sorted(distances))
        self.assertAlmostEqual(distances[-1], 4_000.0, delta=20.0)

        terminal = road_nodes[-1][1]
        self.assertGreater(
            haversine_meters(waypoints[-1], terminal),
            self.config.continuation_reserve_meters,
        )

    def test_returns_no_route_when_every_corridor_is_too_short(self) -> None:
        network = RoadNetwork(nodes={1: (0.0, 0.0)})
        self._add_bidirectional_chain(
            network,
            [(1, (0.0, 0.0)), (2, (0.0, 0.009)), (3, (0.0, 0.018))],
            "primary",
        )

        self.assertEqual(self.planner.plan(network, (0.0, 0.0), heading=90.0), [])

    def test_uses_a_farther_connected_entry_instead_of_the_nearest_dead_spur(self) -> None:
        network = RoadNetwork(nodes={1: (0.0, 0.0)})
        self._add_bidirectional_chain(
            network,
            [(1, (0.0, 0.0)), (2, (0.0, 0.004))],
            "tertiary",
        )

        main_road = [(10, (0.005, 0.0))]
        main_road.extend(
            (node_id, (0.005 + (node_id - 10) * 0.009, 0.0))
            for node_id in range(11, 19)
        )
        self._add_bidirectional_chain(network, main_road, "primary")

        waypoints = self.planner.plan(network, (0.0, 0.0), heading=0.0)

        self.assertEqual(len(waypoints), 4)
        self.assertTrue(all(latitude > 0.005 for latitude, _ in waypoints))

    def test_avoids_a_blocked_area_on_the_middle_of_a_road_segment(self) -> None:
        network = RoadNetwork(nodes={1: (0.0, 0.0)})
        east_nodes = [(1, (0.0, 0.0))]
        east_nodes.extend(
            (node_id, (0.0, (node_id - 1) * 0.009))
            for node_id in range(2, 10)
        )
        north_nodes = [(1, (0.0, 0.0))]
        north_nodes.extend(
            (node_id, ((node_id - 9) * 0.009, 0.0))
            for node_id in range(10, 18)
        )
        self._add_bidirectional_chain(network, east_nodes, "primary")
        self._add_bidirectional_chain(network, north_nodes, "primary")

        waypoints = self.planner.plan(
            network,
            (0.0, 0.0),
            heading=90.0,
            avoidance_zones=[
                AvoidanceGeometry(
                    center=(0.0005, 0.0225),
                    radius_meters=150.0,
                )
            ],
        )

        self.assertEqual(len(waypoints), 4)
        self.assertTrue(all(latitude > 0.0 for latitude, _ in waypoints))
        self.assertTrue(all(abs(longitude) < 0.000001 for _, longitude in waypoints))

    def test_detects_a_zone_between_sparse_road_nodes(self) -> None:
        distance = distance_point_to_segment_meters(
            (0.0005, 0.01),
            (0.0, 0.0),
            (0.0, 0.02),
        )

        self.assertLess(distance, 60.0)

    def test_street_corridor_blocks_parallel_edges_but_allows_crossing(self) -> None:
        street = AvoidanceGeometry(
            center=(0.0, 0.01),
            radius_meters=35.0,
            paths=(((0.0, 0.0), (0.0, 0.02)),),
        )

        self.assertTrue(
            segment_is_blocked((0.0001, 0.0), (0.0001, 0.02), street)
        )
        self.assertFalse(
            segment_is_blocked((-0.01, 0.01), (0.01, 0.01), street)
        )

    @staticmethod
    def _add_bidirectional_chain(
        network: RoadNetwork,
        nodes,
        road_class: str,
    ) -> None:
        for node_id, coordinate in nodes:
            network.nodes[node_id] = coordinate
        for (source, _), (target, _) in zip(nodes, nodes[1:]):
            network.add_edge(source, target, road_class)
            network.add_edge(target, source, road_class)


if __name__ == "__main__":
    unittest.main()
