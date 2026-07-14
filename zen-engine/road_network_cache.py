from __future__ import annotations

import gzip
import json
import logging
import os
from typing import Any, Dict, List, Optional


logger = logging.getLogger(__name__)
DEFAULT_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60


class RedisRoadNetworkCache:
    """Persistent cache for OSM payloads, shared across Zen Engine restarts."""

    def __init__(
        self,
        redis_url: str | None = None,
        ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
    ) -> None:
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://redis:6379")
        self.ttl_seconds = ttl_seconds
        self._client = None

    def _redis(self):
        if self._client is None:
            import redis.asyncio as redis

            self._client = redis.from_url(self.redis_url)
        return self._client

    async def get(self, key: str) -> Optional[List[Dict[str, Any]]]:
        try:
            payload = await self._redis().get(key)
            if not payload:
                return None
            decoded = json.loads(gzip.decompress(payload).decode("utf-8"))
            return decoded if isinstance(decoded, list) else None
        except Exception as error:
            logger.warning("Could not read the persistent road cache: %s", error)
            return None

    async def set(self, key: str, elements: List[Dict[str, Any]]) -> None:
        try:
            payload = gzip.compress(
                json.dumps(elements, separators=(",", ":")).encode("utf-8")
            )
            await self._redis().set(key, payload, ex=self.ttl_seconds)
        except Exception as error:
            logger.warning("Could not persist the road cache: %s", error)
