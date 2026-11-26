"""Post-deploy warm-up gate.

A freshly started backend container used to report healthy as soon as uvicorn
answered, so `docker compose up --wait` swapped it in with cold caches and the
first users paid for the cold forecast fits (up to ~60s each on prod).

The container now runs a small, *bounded* warm-up at startup and only reports
ready (``/health/ready`` -> 200) once it has finished or its time budget ran
out. The budget is what keeps a provider outage from blocking deploys: when it
expires the container is marked ready anyway (``state="timeout"``) and the
regular background warm loop keeps trying.

``/health`` itself is unchanged in semantics (always 200, reports ``version``)
and only gains an informational ``warm`` block.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Awaitable, Callable, Optional, Sequence

logger = logging.getLogger(__name__)

# Most viewed tickers; a subset of forecast.WARM_TICKERS. The rest are warmed by
# the background loop after the container is already serving.
DEFAULT_STARTUP_TICKERS = ("SPY", "QQQ", "AAPL", "NVDA", "MSFT")
DEFAULT_TIMEOUT_S = 45.0  # deploys stop the old stack first, so this is added downtime

# States: pending (not started), warming, ready, timeout, error, skipped.
# Everything except pending/warming counts as "ready" for traffic.
_READY_STATES = {"ready", "timeout", "error", "skipped"}

_state: dict = {"state": "pending", "started_at": None, "finished_at": None,
                "warmed": 0, "detail": None}


def status() -> dict:
    out = dict(_state)
    if out["started_at"] is not None:
        end = out["finished_at"] or time.time()
        out["elapsed_s"] = round(end - out["started_at"], 1)
    out.pop("started_at", None)
    out.pop("finished_at", None)
    out["ready"] = is_ready()
    return out


def is_ready() -> bool:
    return _state["state"] in _READY_STATES


def mark_skipped(detail: str) -> None:
    _state.update(state="skipped", detail=detail, finished_at=time.time())


def reset() -> None:
    """Test helper."""
    _state.update(state="pending", started_at=None, finished_at=None, warmed=0, detail=None)


def timeout_s() -> float:
    try:
        return max(0.0, float(os.environ.get("WARMUP_TIMEOUT_S", DEFAULT_TIMEOUT_S)))
    except ValueError:
        return DEFAULT_TIMEOUT_S


def startup_tickers() -> tuple[str, ...]:
    raw = os.environ.get("WARMUP_TICKERS")
    if raw is None:
        return DEFAULT_STARTUP_TICKERS
    return tuple(t.strip().upper() for t in raw.split(",") if t.strip())


async def run_startup_warmup(
    warm: Callable[[Sequence[str]], Awaitable[int]],
    tickers: Optional[Sequence[str]] = None,
    timeout: Optional[float] = None,
) -> dict:
    """Run ``warm(tickers)`` once, bounded by ``timeout`` seconds.

    Never raises (except cancellation): any outcome leaves the container ready.
    """
    tickers = tuple(startup_tickers() if tickers is None else tickers)
    timeout = timeout_s() if timeout is None else timeout
    _state.update(state="warming", started_at=time.time(), finished_at=None, warmed=0, detail=None)
    if not tickers or timeout <= 0:
        _state.update(state="skipped", detail="no tickers or zero budget", finished_at=time.time())
        return status()
    try:
        n = await asyncio.wait_for(warm(tickers), timeout=timeout)
        _state.update(state="ready", warmed=int(n or 0), detail=f"{len(tickers)} tickers checked")
    except asyncio.TimeoutError:
        _state.update(state="timeout", detail=f"warm-up exceeded {timeout:.0f}s; serving anyway")
        logger.warning("startup warm-up timed out after %.0fs; marking ready", timeout)
    except asyncio.CancelledError:
        raise
    except Exception as e:  # provider outage etc. must not block the deploy
        _state.update(state="error", detail=f"{type(e).__name__}: {e}"[:200])
        logger.warning("startup warm-up failed (%s); marking ready", e)
    _state["finished_at"] = time.time()
    logger.info("startup warm-up %s: %s", _state["state"], _state["detail"])
    return status()
