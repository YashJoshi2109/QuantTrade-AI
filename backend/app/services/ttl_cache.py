"""
In-memory TTL cache for reducing redundant API calls.
Thread-safe, Redis-compatible key scheme.
"""
import time
import threading
from typing import Any, Optional, Dict

# Default TTLs in seconds by data category
DEFAULT_TTLS: Dict[str, int] = {
    "quote": 15,
    "technicals": 900,          # 15 min
    "news": 600,                # 10 min
    "sentiment": 600,
    "options": 60,
    "fundamentals": 86400 * 7,  # 7 days
    "risk": 900,
    "regime": 900,
    "screener": 60,
    "sector": 300,
}


class TTLCache:
    """Simple in-memory cache with per-key expiry."""

    def __init__(self) -> None:
        self._store: Dict[str, tuple[Any, float]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.time() > expires_at:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        if ttl is None:
            category = key.split(":")[0]
            ttl = DEFAULT_TTLS.get(category, 60)
        with self._lock:
            self._store[key] = (value, time.time() + ttl)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear_prefix(self, prefix: str) -> int:
        with self._lock:
            to_delete = [k for k in self._store if k.startswith(prefix)]
            for k in to_delete:
                del self._store[k]
            return len(to_delete)

    def ttl_remaining(self, key: str) -> Optional[float]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            _, expires_at = entry
            remaining = expires_at - time.time()
            return max(0, remaining)

    def cleanup(self) -> int:
        """Remove expired entries."""
        now = time.time()
        with self._lock:
            expired = [k for k, (_, exp) in self._store.items() if now > exp]
            for k in expired:
                del self._store[k]
            return len(expired)


# Singleton instance
cache = TTLCache()
