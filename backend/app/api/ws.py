"""
WebSocket endpoints for real-time market data push and community updates.

Channels:
- /ws/ideas     — Live trade ideas + market pulse updates
- /ws/pulse     — Market pulse sidebar updates only
- /ws/scanner   — Market scanner real-time results
- /ws/news      — News intelligence clusters (new/updated)
- /ws/community/{channel} — Community real-time updates:
    - feed:{community_slug} — new posts in a community
    - post:{post_id}        — new comments, votes on a post
    - user:{user_id}        — personal notifications
    - trending              — trending ticker updates
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


# ── Shared Redis -> WebSocket fan-out ───────────────────────────────────────
# Exactly one Redis listener per (process, channel), ref-counted by connected
# sockets. Each listener broadcasts to every socket on its ws channel, so the
# old one-listener-per-socket pattern delivered every message N times to each
# of N clients.

_listeners: dict = {}       # redis channel -> asyncio.Task
_listener_refs: dict = {}   # redis channel -> connected sockets


def _listener_acquire(redis_channel: str, ws_channel: str) -> None:
    _listener_refs[redis_channel] = _listener_refs.get(redis_channel, 0) + 1
    task = _listeners.get(redis_channel)
    if task is None or task.done() or task.get_loop() is not asyncio.get_running_loop():
        _listeners[redis_channel] = asyncio.create_task(_redis_listener(redis_channel, ws_channel))


def _listener_release(redis_channel: str) -> None:
    n = max(0, _listener_refs.get(redis_channel, 0) - 1)
    _listener_refs[redis_channel] = n
    if n == 0:
        task = _listeners.pop(redis_channel, None)
        if task is not None:
            task.cancel()


def listener_count(redis_channel: str) -> int:
    """Test/diagnostic helper: live listener tasks for a channel (0 or 1)."""
    t = _listeners.get(redis_channel)
    return int(t is not None and not t.done())


@router.websocket("/ws/ideas")
async def ideas_websocket(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """WebSocket for live trade ideas updates."""
    channel = "ideas"
    await ws_manager.connect(websocket, channel)

    # Shared Redis listener (one per process for this channel)
    _listener_acquire("qt:ws:ideas", channel)

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
        _listener_release("qt:ws:ideas")
        await ws_manager.disconnect(websocket, channel)


@router.websocket("/ws/pulse")
async def pulse_websocket(websocket: WebSocket):
    """WebSocket for market pulse sidebar updates."""
    channel = "pulse"
    await ws_manager.connect(websocket, channel)

    _listener_acquire("qt:ws:pulse", channel)

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
        _listener_release("qt:ws:pulse")
        await ws_manager.disconnect(websocket, channel)


@router.websocket("/ws/scanner")
async def scanner_websocket(websocket: WebSocket):
    """WebSocket for market scanner real-time results."""
    channel = "scanner"
    await ws_manager.connect(websocket, channel)

    _listener_acquire("qt:ws:scanner", channel)

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
        _listener_release("qt:ws:scanner")
        await ws_manager.disconnect(websocket, channel)


# ── News intelligence WebSocket ─────────────────────────────────────────────

NEWS_REDIS_CHANNEL = "qt:ws:news"


@router.websocket("/ws/news")
async def news_websocket(websocket: WebSocket):
    """Live news clusters: {"type":"news","item":{...same shape as /news/feed items...}}.

    Sent for every new cluster and whenever a cluster gains a source or an AI
    note. Clients reply "ping" -> "pong"; server sends {"type":"heartbeat"}
    after 30s of silence."""
    channel = "news"
    await ws_manager.connect(websocket, channel)
    _listener_acquire(NEWS_REDIS_CHANNEL, channel)
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
        logger.debug(f"WS news error: {e}")
    finally:
        _listener_release(NEWS_REDIS_CHANNEL)
        await ws_manager.disconnect(websocket, channel)


# ── Community WebSocket ─────────────────────────────────────────────────────


_PUBLIC_COMMUNITY_PREFIXES = {"feed", "post", "trending"}
_PRIVATE_COMMUNITY_PREFIXES = {"user", "dm"}


def _ws_user_id(websocket: WebSocket, token: Optional[str]) -> Optional[int]:
    """Resolve the authenticated user from the session cookie (sent on same-origin
    WebSocket upgrades) or an explicit ?token= query param."""
    from app.api.auth import decode_token
    from app.auth.jwt import COOKIE_NAME

    raw = token or websocket.cookies.get(COOKIE_NAME)
    return decode_token(raw) if raw else None


def _is_dm_participant(conversation_id: int, user_id: int) -> bool:
    from app.db.database import SessionLocal
    from app.models.messaging import ConversationParticipant

    if SessionLocal is None:
        return False
    db = SessionLocal()
    try:
        return (
            db.query(ConversationParticipant.id)
            .filter(
                ConversationParticipant.conversation_id == conversation_id,
                ConversationParticipant.user_id == user_id,
            )
            .first()
            is not None
        )
    finally:
        db.close()


async def _authorize_community_channel(websocket: WebSocket, channel: str, token: Optional[str]) -> bool:
    """Public channels are open; user:{id} and dm:{id} require the owner / a participant."""
    prefix, _, ident = channel.partition(":")
    if prefix in _PUBLIC_COMMUNITY_PREFIXES:
        return True
    if prefix not in _PRIVATE_COMMUNITY_PREFIXES or not ident.isdigit():
        return False
    user_id = _ws_user_id(websocket, token)
    if not user_id:
        return False
    if prefix == "user":
        return int(ident) == user_id
    return await asyncio.to_thread(_is_dm_participant, int(ident), user_id)


@router.websocket("/ws/community/{channel}")
async def community_websocket(
    websocket: WebSocket,
    channel: str,
    token: Optional[str] = Query(None),
):
    """
    WebSocket for real-time community updates.

    Channels:
      - feed:{community_slug} — new posts in a community   (public)
      - post:{post_id}        — new comments, votes on a post (public)
      - trending              — trending ticker updates      (public)
      - user:{user_id}        — personal notifications       (owner only)
      - dm:{conversation_id}  — direct messages              (participants only)
    """
    if not await _authorize_community_channel(websocket, channel, token):
        # 1008 = policy violation; close before accept so nothing is streamed.
        await websocket.close(code=1008)
        return

    ws_channel = f"community:{channel}"
    await ws_manager.connect(websocket, ws_channel)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await ws_manager.disconnect(websocket, ws_channel)


@router.get("/ws/stats")
def ws_stats():
    """Get WebSocket connection statistics."""
    channels = ws_manager.get_channels()
    return {
        "channels": {ch: ws_manager.get_connection_count(ch) for ch in channels},
        "total_connections": ws_manager.get_connection_count(),
    }
