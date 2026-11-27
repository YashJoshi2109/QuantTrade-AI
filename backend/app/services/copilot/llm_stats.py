"""In-memory ring buffer of Copilot LLM outcomes, read by the system-status page.

One entry per copilot request that reached the language model (canned refusals
never call it and are not recorded), plus the synthetic health check, which is
kept apart so it never skews the real-traffic error rate or latency.

No prompt or answer text is stored: only time, provider, model, outcome,
latency (first token and total, ms) and an error class.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional

RING_N = 100


class LLMStats:
    def __init__(self, n: int = RING_N, clock=time.time) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._real: Deque[Dict[str, Any]] = deque(maxlen=n)
        self._synthetic: Optional[Dict[str, Any]] = None
        self._last_ok: Optional[Dict[str, Any]] = None

    def record(self, *, provider: Optional[str], model: Optional[str], ok: bool,
               latency_ms: Optional[float] = None, first_token_ms: Optional[float] = None,
               error: Optional[str] = None, synthetic: bool = False) -> None:
        e = {"at": self._clock(), "provider": provider, "model": model, "ok": bool(ok),
             "latency_ms": None if latency_ms is None else int(latency_ms),
             "first_token_ms": None if first_token_ms is None else int(first_token_ms),
             "error": (error or None) and str(error)[:120], "synthetic": synthetic}
        with self._lock:
            if synthetic:
                self._synthetic = e
            else:
                self._real.append(e)
            if ok:
                self._last_ok = e

    def reset(self) -> None:
        with self._lock:
            self._real.clear()
            self._synthetic = None
            self._last_ok = None

    def summary(self) -> Dict[str, Any]:
        with self._lock:
            real: List[Dict[str, Any]] = list(self._real)
            synthetic = dict(self._synthetic) if self._synthetic else None
            last_ok = dict(self._last_ok) if self._last_ok else None
        lat = sorted(e["latency_ms"] for e in real if e["ok"] and e["latency_ms"] is not None)
        ftt = sorted(e["first_token_ms"] for e in real if e["ok"] and e["first_token_ms"] is not None)
        errors = [e for e in real if not e["ok"]]
        by_provider: Dict[str, int] = {}
        for e in real:
            if e["ok"] and e["provider"]:
                key = f"{e['provider']}:{e['model']}"
                by_provider[key] = by_provider.get(key, 0) + 1
        return {
            "requests": len(real),
            "errors": len(errors),
            "error_rate": round(len(errors) / len(real), 3) if real else None,
            "p50_ms": _pct(lat, 0.5), "p95_ms": _pct(lat, 0.95),
            "first_token_p50_ms": _pct(ftt, 0.5),
            "last_ok_at": last_ok["at"] if last_ok else None,
            "last_ok_provider": last_ok["provider"] if last_ok else None,
            "last_ok_model": last_ok["model"] if last_ok else None,
            "last_error": errors[-1]["error"] if errors else None,
            "last_error_at": errors[-1]["at"] if errors else None,
            "last_request_at": real[-1]["at"] if real else None,
            "recent_outcomes": [e["ok"] for e in real[-10:]],
            "served_by": by_provider,
            "synthetic": synthetic,
        }


def _pct(vals: List[int], q: float) -> Optional[int]:
    if not vals:
        return None
    k = max(0, min(len(vals) - 1, int(round(q * (len(vals) - 1)))))
    return int(vals[k])


stats = LLMStats()
