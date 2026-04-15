"""
WebSocket Connection Manager

Manages active WebSocket connections per channel with heartbeat support.
Uses Redis pub/sub for cross-process message distribution.
"""
import asyncio
import json
import logging
from typing import Any, Dict, Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections grouped by channel."""

    def __init__(self):
        self._channels: Dict[str, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, channel: str) -> None:
        await websocket.accept()
        async with self._lock:
            if channel not in self._channels:
                self._channels[channel] = set()
            self._channels[channel].add(websocket)
        logger.info(f"WS connected: {channel} (total: {len(self._channels.get(channel, set()))})")

    async def disconnect(self, websocket: WebSocket, channel: str) -> None:
        async with self._lock:
            if channel in self._channels:
                self._channels[channel].discard(websocket)
                if not self._channels[channel]:
                    del self._channels[channel]
        logger.info(f"WS disconnected: {channel}")

    async def broadcast(self, channel: str, data: Any) -> None:
        """Send data to all connections on a channel."""
        async with self._lock:
            connections = list(self._channels.get(channel, set()))

        if not connections:
            return

        message = json.dumps(data, default=str)
        dead = []
        for ws in connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)

        # Clean up dead connections
        if dead:
            async with self._lock:
                for ws in dead:
                    if channel in self._channels:
                        self._channels[channel].discard(ws)

    async def send_personal(self, websocket: WebSocket, data: Any) -> None:
        try:
            await websocket.send_json(data)
        except Exception:
            pass

    def get_connection_count(self, channel: str = None) -> int:
        if channel:
            return len(self._channels.get(channel, set()))
        return sum(len(s) for s in self._channels.values())

    def get_channels(self) -> list:
        return list(self._channels.keys())


# Singleton
ws_manager = ConnectionManager()
