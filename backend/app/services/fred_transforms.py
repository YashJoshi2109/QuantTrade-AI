"""
Pure FRED observation -> display transforms for the Global Monitor
Economic Indicators panel.

Every FRED series has its own native unit. The old code printed raw values
with one shared "$B" suffix, so WALCL (millions of USD) showed as
"6,741,452$B" and CPIAUCSL (an index level) showed as "337.48%". Each series
now declares its native unit ("kind") and is converted before formatting:

  usd_millions  value / 1000 -> billions, shown as $X.XXT or $X.XB
  usd_billions  value already in billions, shown as $X.XXT or $X.XB
  pct           already a percent (rates, spreads, yields)
  yoy_pct       index level -> year-over-year percent, needs 12 periods back
  usd           a dollar price ($/bbl, $/gal, $/MMBtu)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

# How many observations each kind needs (FRED sort_order=desc).
# yoy_pct needs ~2 years of monthly data so a missing month (".") can be skipped.
OBS_LIMIT: Dict[str, int] = {"yoy_pct": 26}
DEFAULT_OBS_LIMIT = 5


@dataclass(frozen=True)
class IndicatorDisplay:
    value: str
    date: str
    change: Optional[str]
    change_direction: str  # up, down, flat


def obs_limit(kind: str) -> int:
    return OBS_LIMIT.get(kind, DEFAULT_OBS_LIMIT)


def valid_observations(observations: Sequence[dict]) -> List[dict]:
    """Drop FRED missing values ('.') and anything that is not a number."""
    out: List[dict] = []
    for o in observations or []:
        raw = o.get("value")
        if raw in (None, "", "."):
            continue
        try:
            float(raw)
        except (TypeError, ValueError):
            continue
        out.append(o)
    return out


def yoy_percent(current: float, year_ago: float) -> Optional[float]:
    """(x_t / x_{t-12} - 1) * 100."""
    if not year_ago:
        return None
    return (current / year_ago - 1.0) * 100.0


def format_usd_billions(billions: float, signed: bool = False) -> str:
    sign = ""
    if signed:
        sign = "+" if billions > 0 else "-" if billions < 0 else ""
    elif billions < 0:
        sign = "-"
    a = abs(billions)
    if a >= 1000:
        return f"{sign}${a / 1000:,.2f}T"
    return f"{sign}${a:,.1f}B"


def _direction(change: float) -> str:
    return "up" if change > 0 else "down" if change < 0 else "flat"


def transform_observations(kind: str, observations: Sequence[dict]) -> Optional[IndicatorDisplay]:
    """Turn FRED observations (newest first) into display strings.

    Returns None when there is not enough valid data for this kind.
    """
    obs = valid_observations(observations)
    if not obs:
        return None
    vals = [float(o["value"]) for o in obs]
    date = str(obs[0].get("date", "—"))

    if kind == "yoy_pct":
        # Match by calendar month, not list position: FRED has gaps (e.g. CPI for
        # 2025-10 is "." after the shutdown), and a positional t-12 would then
        # compare against the wrong month. Use the newest month whose year-ago
        # value exists; its date is reported, so a skipped month is visible.
        by_date = {str(o.get("date")): float(o["value"]) for o in obs}

        def year_ago(d: str) -> Optional[str]:
            try:
                return f"{int(d[:4]) - 1:04d}{d[4:]}"
            except (TypeError, ValueError):
                return None

        yoys: List[tuple] = []
        for o in obs:
            d = str(o.get("date"))
            prior = year_ago(d)
            if prior in by_date:
                pct = yoy_percent(by_date[d], by_date[prior])
                if pct is not None:
                    yoys.append((d, pct))
            if len(yoys) == 2:
                break
        if not yoys:
            return None
        cur_date, cur = yoys[0]
        change = cur - yoys[1][1] if len(yoys) > 1 else None
        return IndicatorDisplay(
            value=f"{cur:.2f}%",
            date=cur_date,
            change=None if change is None else f"{change:+.2f}pp",
            change_direction=_direction(change or 0.0),
        )

    current = vals[0]
    prev = vals[1] if len(vals) > 1 else current

    if kind in ("usd_millions", "usd_billions"):
        scale = 1000.0 if kind == "usd_millions" else 1.0
        cur_b = current / scale
        chg_b = (current - prev) / scale
        return IndicatorDisplay(
            value=format_usd_billions(cur_b),
            date=date,
            change=format_usd_billions(chg_b, signed=True),
            change_direction=_direction(chg_b),
        )

    change = current - prev
    if kind == "usd":
        return IndicatorDisplay(
            value=f"${current:,.2f}",
            date=date,
            change=f"{change:+.2f}",
            change_direction=_direction(change),
        )

    # pct (default)
    return IndicatorDisplay(
        value=f"{current:.2f}%",
        date=date,
        change=f"{change:+.2f}pp",
        change_direction=_direction(change),
    )
