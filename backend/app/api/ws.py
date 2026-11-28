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

Account controls (app.services.ws_sessions): a token for a suspended account
is closed with 4403, a token from before "revoke sessions" with 4401, at
connect, every 30 s, and immediately when an admin acts. Anonymous visitors
keep the public channels.
"""
import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from app.services import ws_sessions
from app.services.ws_manager import ws_manager
from app.services.redis_cache_service import cache_service

logger = logging.getLogger(__name__)

router = APIRouter()


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


async def _heartbeat_loop(websocket: WebSocket) -> None:
    """Answer "ping" with "pong"; send a heartbeat after 30 s of silence."""
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


async def _serve_public_channel(websocket: WebSocket, token: Optional[str], channel: str,
                                redis_channel: str, initial=None) -> None:
    """Public market/news stream. Anonymous visitors are allowed; a signed-in
    visitor's token is held to the account controls (ws_sessions): suspended
    -> 4403, revoked -> 4401, at connect and every 30 s while connected."""
    allowed, ident = await ws_sessions.admit(websocket, token)
    if not allowed:
        return
    await ws_manager.connect(websocket, channel)
    _listener_acquire(redis_channel, channel)
    try:
        async with ws_sessions.guarded(websocket, ident):
            if initial is not None:
                await initial()
            await _heartbeat_loop(websocket)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"WS {channel} error: {e}")
    finally:
        _listener_release(redis_channel)
        await ws_manager.disconnect(websocket, channel)


@router.websocket("/ws/ideas")
async def ideas_websocket(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """WebSocket for live trade ideas updates."""
    async def initial():
        cached_ideas = await cache_service.get("qt:ideas:trending")
        if cached_ideas:
            await ws_manager.send_personal(websocket, {"type": "initial", "data": cached_ideas})

    await _serve_public_channel(websocket, token, "ideas", "qt:ws:ideas", initial)


@router.websocket("/ws/pulse")
async def pulse_websocket(websocket: WebSocket, token: Optional[str] = Query(None)):
    """WebSocket for market pulse sidebar updates."""
    async def initial():
        cached_pulse = await cache_service.get("qt:pulse:market")
        if cached_pulse:
            await ws_manager.send_personal(websocket, {"type": "pulse_update", "data": cached_pulse})

    await _serve_public_channel(websocket, token, "pulse", "qt:ws:pulse", initial)


@router.websocket("/ws/scanner")
async def scanner_websocket(websocket: WebSocket, token: Optional[str] = Query(None)):
    """WebSocket for market scanner real-time results."""
    await _serve_public_channel(websocket, token, "scanner", "qt:ws:scanner")


# ── News intelligence WebSocket ─────────────────────────────────────────────

NEWS_REDIS_CHANNEL = "qt:ws:news"


@router.websocket("/ws/news")
async def news_websocket(websocket: WebSocket, token: Optional[str] = Query(None)):
    """Live news clusters: {"type":"news","item":{...same shape as /news/feed items...}}.

    Sent for every new cluster and whenever a cluster gains a source or an AI
    note. Clients reply "ping" -> "pong"; server sends {"type":"heartbeat"}
    after 30s of silence."""
    await _serve_public_channel(websocket, token, "news", NEWS_REDIS_CHANNEL)


# ── Community WebSocket ─────────────────────────────────────────────────────


_PUBLIC_COMMUNITY_PREFIXES = {"feed", "post", "trending"}
_PRIVATE_COMMUNITY_PREFIXES = {"user", "dm"}


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


async def _authorize_community_channel(channel: str, user_id: Optional[int]) -> bool:
    """Public channels are open; user:{id} and dm:{id} require the owner / a participant.
    ``user_id`` comes from ws_sessions.admit (token already held to the account controls)."""
    prefix, _, ident = channel.partition(":")
    if prefix in _PUBLIC_COMMUNITY_PREFIXES:
        return True
    if prefix not in _PRIVATE_COMMUNITY_PREFIXES or not ident.isdigit():
        return False
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
    # Suspended -> 4403, revoked session -> 4401 (socket accepted, then closed).
    allowed, ident = await ws_sessions.admit(websocket, token)
    if not allowed:
        return
    if not await _authorize_community_channel(channel, ident.user_id if ident else None):
        # 1008 = policy violation; close before accept so nothing is streamed.
        await websocket.close(code=1008)
        return

    ws_channel = f"community:{channel}"
    await ws_manager.connect(websocket, ws_channel)
    try:
        async with ws_sessions.guarded(websocket, ident):
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
