"""
Per-user admin controls read on the auth path: suspension, session version
(revocation), plan override, AI quota override; plus sign-in history.

Reads fail open only when the user_account_controls table does not exist yet
(fresh deploy before create_all / the migration script, or a unit test that
creates a subset of tables). Any other DB error propagates.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.models.admin import UserAccountControl, UserLoginEvent

logger = logging.getLogger(__name__)

PLAN_OVERRIDES = ("free", "pro")


def _missing_table(exc: Exception) -> bool:
    msg = str(exc).lower()
    return ("no such table" in msg or "does not exist" in msg or "undefinedtable" in msg) and (
        "user_account_controls" in msg or "user_login_events" in msg
    )


# bind id -> (exists, checked_at). "exists" is cached for good; "missing" is
# re-checked every 30 s so the table is picked up once create_all has run.
_table_seen: Dict[int, Tuple[bool, float]] = {}


def _controls_table_exists(db: Session) -> bool:
    bind = db.get_bind()
    key = id(getattr(bind, "engine", bind))
    hit = _table_seen.get(key)
    if hit and (hit[0] or time.monotonic() - hit[1] < 30):
        return hit[0]
    from sqlalchemy import inspect
    try:
        exists = inspect(bind).has_table(UserAccountControl.__tablename__)
    except Exception:  # noqa: BLE001
        exists = False
    _table_seen[key] = (exists, time.monotonic())
    return exists


def get_controls(db: Session, user_id: int) -> Optional[UserAccountControl]:
    # Checking for the table first (instead of catching the error) keeps the
    # caller's transaction intact: a rollback would drop pending changes such
    # as a Google account link made just before this call.
    if not _controls_table_exists(db):
        return None
    try:
        return db.get(UserAccountControl, user_id)
    except (OperationalError, ProgrammingError) as exc:
        if not _missing_table(exc):
            raise
        _table_seen.pop(id(getattr(db.get_bind(), "engine", db.get_bind())), None)
        db.rollback()
        return None


def get_or_create_controls(db: Session, user_id: int) -> UserAccountControl:
    row = db.get(UserAccountControl, user_id)
    if row is None:
        row = UserAccountControl(user_id=user_id, session_version=0)
        db.add(row)
        db.flush()
    return row


def session_version(db: Session, user_id: int) -> int:
    c = get_controls(db, user_id)
    return int(c.session_version or 0) if c else 0


def is_suspended(c: Optional[UserAccountControl]) -> bool:
    return bool(c is not None and c.suspended_at is not None)


def token_allowed(c: Optional[UserAccountControl], token_sv: int) -> bool:
    """A token is usable if the account is not suspended and was issued at or
    after the current session version."""
    if c is None:
        return True
    if c.suspended_at is not None:
        return False
    return int(token_sv or 0) >= int(c.session_version or 0)


# ── DB-less routes ───────────────────────────────────────────────────────────
# _guard_token-only routes (backtests, reports) never open a request session.
# They check suspension / revocation against this cache, filled from a short
# dedicated session. TTL bounds how long a revoked token keeps working on
# another API worker for those routes; this process clears its entry at once.

_FAST_TTL_S = 5.0
_fast_cache: Dict[int, Tuple[float, Optional[datetime], int]] = {}
_fast_lock = threading.Lock()


def invalidate_fast_cache(user_id: Optional[int] = None) -> None:
    with _fast_lock:
        if user_id is None:
            _fast_cache.clear()
        else:
            _fast_cache.pop(int(user_id), None)


def fast_token_check(user_id: int, token_sv: int) -> bool:
    return fast_token_verdict(user_id, token_sv) == "ok"


def fast_token_verdict(user_id: int, token_sv: int) -> str:
    """"ok" | "suspended" | "revoked" (cached; fails open when the DB is unreachable)."""
    now = time.monotonic()
    with _fast_lock:
        hit = _fast_cache.get(user_id)
    if hit is None or now - hit[0] > _FAST_TTL_S:
        try:
            from app.db import database as _database
            if _database.SessionLocal is None:
                return "ok"
            s = _database.SessionLocal()
            try:
                c = get_controls(s, user_id)
                hit = (now, c.suspended_at if c else None, int(c.session_version or 0) if c else 0)
            finally:
                s.close()
        except Exception:  # noqa: BLE001  DB unreachable: those routes do not use the DB either
            return "ok"
        with _fast_lock:
            if len(_fast_cache) > 50_000:
                _fast_cache.clear()
            _fast_cache[user_id] = hit
    _, suspended_at, sv = hit
    if suspended_at is not None:
        return "suspended"
    return "ok" if int(token_sv or 0) >= sv else "revoked"


def record_login(db: Session, user_id: int, method: str, ip: Optional[str], user_agent: Optional[str],
                 success: bool = True, note: Optional[str] = None) -> None:
    """Best effort: sign-in must never fail because history could not be written."""
    try:
        db.add(UserLoginEvent(
            user_id=user_id, method=method[:16], success=success, note=(note or None) and note[:64],
            ip=(ip or None) and ip[:64], user_agent=(user_agent or None) and user_agent[:300],
            ts=datetime.now(timezone.utc),
        ))
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.debug("login event not recorded: %s", type(exc).__name__)
