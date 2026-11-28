"""Account controls (suspension, session revocation) for live WebSockets.

HTTP routes re-check the admin console's account controls on every request
(``get_current_user`` / ``fast_token_verdict``). A WebSocket only had its JWT
checked once, at the upgrade, so a suspended user, or one whose sessions an
admin revoked, kept receiving live data until they closed the tab.

Rules:

* **Connect.** The token (``?token=`` or the session cookie) is decoded with
  ``decode_claims``. A token for a suspended account is closed with 4403; a
  token issued before the latest "revoke sessions" is closed with 4401. The
  socket is accepted first so the browser sees the close code (a close before
  accept reaches it as a bare HTTP 403 / code 1006).
* **No token, or an invalid / expired one,** is an anonymous visitor: public
  channels stay open to them exactly as for any logged-out user. Private
  channels (``user:{id}``, ``dm:{id}``) require a valid token.
* **While connected.** Every ``RECHECK_S`` (30 s) the verdict is checked again
  through ``fast_token_verdict`` (5 s cache, one primary-key read) and the
  socket is closed with 4403 / 4401 when it is no longer allowed.
* **Admin actions.** "Suspend" and "Revoke sessions" call
  :func:`notify_account_change`, which re-checks that user's sockets in this
  process at once and publishes the user id on ``CONTROL_CHANNEL`` so every
  other API process does the same.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

CLOSE_REVOKED = 4401
CLOSE_SUSPENDED = 4403
CLOSE_FOR = {"suspended": CLOSE_SUSPENDED, "revoked": CLOSE_REVOKED}
REASON_FOR = {"suspended": "account suspended", "revoked": "session revoked"}
RECHECK_S = 30.0
CONTROL_CHANNEL = "qt:ws:account_control"


@dataclass(frozen=True)
class WSIdentity:
    user_id: int
    sv: int


def identify(websocket: Any, token: Optional[str]) -> Optional[WSIdentity]:
    """Identity from ``?token=`` or the session cookie; None = anonymous."""
    from app.api.auth import decode_claims
    from app.auth.jwt import COOKIE_NAME

    raw = token
    if not raw:
        try:
            raw = websocket.cookies.get(COOKIE_NAME)
        except Exception:  # noqa: BLE001
            raw = None
    if not raw:
        return None
    claims = decode_claims(raw)
    if not claims:
        return None
    return WSIdentity(int(claims[0]), int(claims[1] or 0))


async def verdict(ident: WSIdentity, fresh: bool = False) -> str:
    """"ok" | "suspended" | "revoked" (cached 5 s unless ``fresh``)."""
    from app.services import account_controls as ac

    if fresh:
        ac.invalidate_fast_cache(ident.user_id)
    try:
        return await asyncio.to_thread(ac.fast_token_verdict, ident.user_id, ident.sv)
    except Exception:  # noqa: BLE001  same fail-open rule as the DB-less HTTP routes
        return "ok"


async def _close(websocket: Any, code: int, reason: str = "") -> None:
    try:
        await websocket.close(code=code, reason=reason)
    except Exception:  # noqa: BLE001  already closed / client gone
        pass


async def admit(websocket: Any, token: Optional[str], *, require_auth: bool = False
                ) -> Tuple[bool, Optional[WSIdentity]]:
    """(allowed, identity). Closes the socket itself when not allowed."""
    ident = identify(websocket, token)
    if ident is None:
        if require_auth:
            await websocket.accept()
            await _close(websocket, CLOSE_REVOKED, "authentication required")
            return False, None
        return True, None
    v = await verdict(ident)
    if v != "ok":
        await websocket.accept()
        await _close(websocket, CLOSE_FOR[v], REASON_FOR[v])
        return False, None
    return True, ident


# ── live registry ────────────────────────────────────────────────────────

class Registry:
    """user id -> {websocket: (identity, loop)} for this process."""

    def __init__(self) -> None:
        self._by_user: Dict[int, Dict[Any, Tuple[WSIdentity, asyncio.AbstractEventLoop]]] = {}
        self._listener: Optional[asyncio.Task] = None

    def register(self, websocket: Any, ident: WSIdentity) -> None:
        loop = asyncio.get_running_loop()
        self._by_user.setdefault(ident.user_id, {})[websocket] = (ident, loop)
        self._ensure_listener(loop)

    def unregister(self, websocket: Any, ident: WSIdentity) -> None:
        socks = self._by_user.get(ident.user_id)
        if socks is not None:
            socks.pop(websocket, None)
            if not socks:
                self._by_user.pop(ident.user_id, None)

    def count(self, user_id: Optional[int] = None) -> int:
        if user_id is None:
            return sum(len(s) for s in self._by_user.values())
        return len(self._by_user.get(int(user_id), {}))

    async def recheck_user(self, user_id: int) -> int:
        """Re-check every socket of ``user_id`` on this loop now; returns how many were closed."""
        loop = asyncio.get_running_loop()
        entries = [(ws, ident) for ws, (ident, lp) in list(self._by_user.get(int(user_id), {}).items())
                   if lp is loop]
        closed = 0
        fresh = True
        for ws, ident in entries:
            v = await verdict(ident, fresh=fresh)
            fresh = False  # one DB read per user, then the 5 s cache
            if v != "ok":
                self.unregister(ws, ident)
                await _close(ws, CLOSE_FOR[v], REASON_FOR[v])
                closed += 1
        return closed

    def recheck_user_threadsafe(self, user_id: int) -> None:
        """Schedule :meth:`recheck_user` on every loop that holds a socket of the user."""
        loops = {lp for _ident, lp in self._by_user.get(int(user_id), {}).values()}
        for lp in loops:
            try:
                running = asyncio.get_running_loop()
            except RuntimeError:
                running = None
            if lp is running:
                lp.create_task(self.recheck_user(user_id))
            elif not lp.is_closed():
                asyncio.run_coroutine_threadsafe(self.recheck_user(user_id), lp)

    # cross-process fan-out
    def _ensure_listener(self, loop: asyncio.AbstractEventLoop) -> None:
        from app.services.redis_cache_service import cache_service

        t = self._listener
        if t is not None and not t.done() and t.get_loop() is loop:
            return
        if not cache_service.available:
            return
        self._listener = loop.create_task(_control_listener(self))


registry = Registry()


async def _control_listener(reg: Registry) -> None:
    from app.services.redis_cache_service import cache_service

    try:
        pubsub = await cache_service.subscribe(CONTROL_CHANNEL)
        if not pubsub:
            return
        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg and msg.get("type") == "message":
                try:
                    uid = int(json.loads(msg["data"]).get("user_id"))
                except (TypeError, ValueError, AttributeError):
                    continue
                if reg.count(uid):
                    await reg.recheck_user(uid)
            await asyncio.sleep(0.1)
    except asyncio.CancelledError:
        pass
    except Exception as e:  # noqa: BLE001
        logger.debug("ws account-control listener error: %s", e)


async def watch(websocket: Any, ident: WSIdentity, interval: float = RECHECK_S) -> None:
    """Close the socket once the account is suspended or the session revoked."""
    try:
        while True:
            await asyncio.sleep(interval)
            v = await verdict(ident)
            if v != "ok":
                registry.unregister(websocket, ident)
                await _close(websocket, CLOSE_FOR[v], REASON_FOR[v])
                return
    except asyncio.CancelledError:
        pass


class guarded:
    """``async with guarded(ws, ident):`` registers an authenticated socket and
    runs its periodic re-check; a no-op for anonymous sockets."""

    def __init__(self, websocket: Any, ident: Optional[WSIdentity]) -> None:
        self.ws, self.ident, self.task = websocket, ident, None

    async def __aenter__(self):
        if self.ident is not None:
            registry.register(self.ws, self.ident)
            self.task = asyncio.create_task(watch(self.ws, self.ident, recheck_interval()))
        return self

    async def __aexit__(self, *exc):
        if self.task is not None:
            self.task.cancel()
        if self.ident is not None:
            registry.unregister(self.ws, self.ident)
        return False


def recheck_interval() -> float:
    try:
        return max(0.01, float(os.environ.get("WS_ACCOUNT_RECHECK_S", "") or RECHECK_S))
    except ValueError:
        return RECHECK_S


# ── admin hook ───────────────────────────────────────────────────────────

async def _publish(user_id: int) -> None:
    from app.services.redis_cache_service import cache_service

    await cache_service.publish(CONTROL_CHANNEL, {"user_id": int(user_id)})


def notify_account_change(user_id: int) -> None:
    """Called by the admin suspend / revoke-sessions actions (sync routes, in
    the threadpool). Never raises: the DB change is already committed and the
    30 s re-check is the backstop."""
    try:
        registry.recheck_user_threadsafe(user_id)
    except Exception as e:  # noqa: BLE001
        logger.debug("ws local recheck failed: %s", e)
    try:
        from app.services.redis_cache_service import cache_service

        if not cache_service.available:
            return
        try:
            import anyio.from_thread

            anyio.from_thread.run(_publish, user_id)
            return
        except RuntimeError:
            pass  # not in an anyio worker thread
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_publish(user_id))
        except RuntimeError:
            logger.debug("ws account-control publish skipped: no event loop")
    except Exception as e:  # noqa: BLE001
        logger.debug("ws account-control publish failed: %s", e)
