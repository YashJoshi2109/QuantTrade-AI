"""
WebSocket endpoints for real-time market data push.

Channels:
- /ws/ideas     — Live trade ideas + market pulse updates
- /ws/pulse     — Market pulse sidebar updates only
- /ws/scanner   — Market scanner real-time results
"""
import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from app.services.ws_manager import ws_manager
from app.services.redis_cache_service import cache_service

logger = logging.getLogger(__name__)

router = APIRouter()


async def _verify_token(token: Optional[str]) -> bool:
    """Verify JWT token for authenticated WebSocket channels."""
    if not token:
        return False
    try:
        from app.api.auth import decode_token
        payload = decode_token(token)
        return payload is not None
    except Exception:
        return False


async def _redis_listener(channel: str, ws_channel: str):
    """Listen to Redis pub/sub and broadcast to WebSocket clients."""
    if not cache_service.available:
        return
    try:
        pubsub = await cache_service.subscribe(channel)
        if not pubsub:
            return
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message["type"] == "message":
                data = json.loads(message["data"])
                await ws_manager.broadcast(ws_channel, data)
            await asyncio.sleep(0.1)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.debug(f"Redis listener error: {e}")


@router.websocket("/ws/ideas")
async def ideas_websocket(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """WebSocket for live trade ideas updates."""
    channel = "ideas"
    await ws_manager.connect(websocket, channel)

    # Start Redis listener if this is the first connection
    listener_task = asyncio.create_task(_redis_listener("qt:ws:ideas", channel))

    try:
        # Send initial data from cache
        cached_ideas = await cache_service.get("qt:ideas:trending")
        if cached_ideas:
            await ws_manager.send_personal(websocket, {
                "type": "initial",
                "data": cached_ideas,
            })

        # Keep connection alive with heartbeat
        while True:
            try:
                # Wait for client messages (ping/pong or commands)
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                if data == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # Send heartbeat
                try:
                    await websocket.send_text(json.dumps({"type": "heartbeat"}))
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"WS ideas error: {e}")
    finally:
        listener_task.cancel()
        await ws_manager.disconnect(websocket, channel)


@router.websocket("/ws/pulse")
async def pulse_websocket(websocket: WebSocket):
    """WebSocket for market pulse sidebar updates."""
    channel = "pulse"
    await ws_manager.connect(websocket, channel)

    listener_task = asyncio.create_task(_redis_listener("qt:ws:pulse", channel))

    try:
        # Send current pulse from cache
        cached_pulse = await cache_service.get("qt:pulse:market")
        if cached_pulse:
            await ws_manager.send_personal(websocket, {
                "type": "pulse_update",
                "data": cached_pulse,
            })

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                if data == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                try:
                    await websocket.send_text(json.dumps({"type": "heartbeat"}))
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"WS pulse error: {e}")
    finally:
        listener_task.cancel()
        await ws_manager.disconnect(websocket, channel)


@router.websocket("/ws/scanner")
async def scanner_websocket(websocket: WebSocket):
    """WebSocket for market scanner real-time results."""
    channel = "scanner"
    await ws_manager.connect(websocket, channel)

    listener_task = asyncio.create_task(_redis_listener("qt:ws:scanner", channel))

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                if data == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                try:
                    await websocket.send_text(json.dumps({"type": "heartbeat"}))
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"WS scanner error: {e}")
    finally:
        listener_task.cancel()
        await ws_manager.disconnect(websocket, channel)
