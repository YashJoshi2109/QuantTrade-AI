"""Realized stock moves around past earnings reports.

Reaction window by report time (US/Eastern):
- before the open (hour < 12): previous close -> close on the report day
- after the close (hour >= 12): close on the report day -> next close
- time unknown (exactly midnight, as some feeds report date-only stamps):
  previous close -> next close, which covers either case.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Dict, Iterable, List, Optional, Sequence


def _ny(stamp) -> Optional[datetime]:
    try:
        ts = stamp.to_pydatetime() if hasattr(stamp, "to_pydatetime") else stamp
    except Exception:
        return None
    if not isinstance(ts, datetime):
        if isinstance(ts, date):
            return datetime(ts.year, ts.month, ts.day)
        return None
    if ts.tzinfo is not None:
        from zoneinfo import ZoneInfo

        ts = ts.astimezone(ZoneInfo("America/New_York")).replace(tzinfo=None)
    return ts


def realized_moves(closes: Dict[date, float], stamps: Iterable, today: date, limit: int = 12) -> List[Dict]:
    """Most recent first: [{date, timing, move_pct}] for reports before ``today``."""
    days: Sequence[date] = sorted(d for d, v in closes.items() if v and v > 0)
    if len(days) < 3:
        return []
    out: List[Dict] = []
    seen = set()
    for raw in stamps:
        ts = _ny(raw)
        if ts is None:
            continue
        d = ts.date()
        if d >= today or d in seen:
            continue
        seen.add(d)
        if ts.hour == 0 and ts.minute == 0:
            timing = "unknown"
        elif ts.hour < 12:
            timing = "bmo"
        else:
            timing = "amc"
        prev = [x for x in days if x < d]
        on_or_after = [x for x in days if x >= d]
        after = [x for x in days if x > d]
        if not prev or not on_or_after:
            continue
        if timing == "bmo":
            a, b = prev[-1], on_or_after[0]
        elif timing == "amc":
            if on_or_after[0] != d or not after:
                continue
            a, b = d, after[0]
        else:
            if not after:
                continue
            a, b = prev[-1], after[0]
        if (b - a).days > 6:  # data gap: not a real reaction window
            continue
        out.append({"date": d.isoformat(), "timing": timing,
                    "move_pct": round((closes[b] / closes[a] - 1.0) * 100, 2)})
    out.sort(key=lambda r: r["date"], reverse=True)
    return out[:limit]


def summarize(moves: List[Dict]) -> Dict:
    if not moves:
        return {"count": 0, "avg_abs_move_pct": None, "median_abs_move_pct": None, "max_abs_move_pct": None,
                "up_count": 0}
    absm = sorted(abs(m["move_pct"]) for m in moves)
    n = len(absm)
    med = absm[n // 2] if n % 2 else 0.5 * (absm[n // 2 - 1] + absm[n // 2])
    return {
        "count": n,
        "avg_abs_move_pct": round(sum(absm) / n, 2),
        "median_abs_move_pct": round(med, 2),
        "max_abs_move_pct": round(absm[-1], 2),
        "up_count": sum(1 for m in moves if m["move_pct"] > 0),
    }
