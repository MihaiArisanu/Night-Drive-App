import unittest
from unittest.mock import AsyncMock, MagicMock, call, patch

try:
    import geo_utils
except ModuleNotFoundError:
    geo_utils = None


@unittest.skipIf(geo_utils is None, "Zen dependencies are installed inside the container")
class GenerateForwardPathTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_the_core_network_without_loading_the_fallback(self) -> None:
        core_network = object()
        expected_path = [(45.01, 24.01)]
        provider = MagicMock()
        provider.fetch = AsyncMock(return_value=core_network)
        planner = MagicMock()
        planner.plan.return_value = expected_path

        with (
            patch.object(geo_utils, "road_network_provider", provider),
            patch.object(geo_utils, "road_path_planner", planner),
        ):
            result = await geo_utils.generate_forward_path_async(45.0, 24.0, 90.0)

        self.assertEqual(result, expected_path)
        provider.fetch.assert_awaited_once_with(
            45.0,
            24.0,
            include_tertiary=False,
        )

    async def test_loads_tertiary_roads_only_when_the_core_has_no_path(self) -> None:
        core_network = object()
        extended_network = object()
        expected_path = [(45.02, 24.02)]
        provider = MagicMock()
        provider.fetch = AsyncMock(side_effect=[core_network, extended_network])
        planner = MagicMock()
        planner.plan.side_effect = [[], expected_path]

        with (
            patch.object(geo_utils, "road_network_provider", provider),
            patch.object(geo_utils, "road_path_planner", planner),
        ):
            result = await geo_utils.generate_forward_path_async(45.0, 24.0, 180.0)

        self.assertEqual(result, expected_path)
        self.assertEqual(
            provider.fetch.await_args_list,
            [
                call(45.0, 24.0, include_tertiary=False),
                call(45.0, 24.0, include_tertiary=True),
            ],
        )


if __name__ == "__main__":
    unittest.main()
