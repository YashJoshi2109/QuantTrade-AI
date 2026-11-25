"""
Impact score (0-100) for a news cluster.

    impact = round(100 * S * W * K * R * N)

  S  sentiment strength   = 0.2 + 0.8 * |score| * confidence
                            (floor 0.2 so big neutral news — an FOMC hold, a
                            merger filing — still ranks; FinBERT calls most
                            factual headlines neutral)
  W  source credibility   = SOURCE_WEIGHTS[source] in [0.4, 1.0], default 0.6
  K  market-cap reach     = 0.3 + 0.7 * clip((log10(max_cap) - 8) / 4.5, 0, 1)
                            ($100M -> 0.3, ~$3T -> 1.0). Items with no ticker:
                            0.75 for market-wide categories (Fed, macro data,
                            geopolitics, energy, crypto), else 0.4.
  R  recency              = 0.5 ** (age_hours / 6) with age measured at
                            scoring time (published -> now); clipped to >= 0.05
  N  corroboration        = min(1, 0.6 + 0.4 * log2(1 + n_sources) / log2(9))
                            (1 source -> 0.73, 3 -> 0.85, 8+ -> 1.0)

Impact is recomputed whenever a cluster gains a source. Stored impact is a
snapshot at (re)scoring time; the feed's `since` window bounds staleness.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Iterable, Optional

MARKET_WIDE = {"macro_fed", "economic_data", "geopolitics", "energy_commodities", "crypto"}

SOURCE_WEIGHTS = {
    # primary / regulatory
    "sec edgar": 1.0, "sec": 1.0, "federal reserve": 1.0,
    # wires & top-tier financial press
    "reuters": 0.95, "bloomberg": 0.95, "the wall street journal": 0.95, "wsj": 0.95,
    "financial times": 0.95, "associated press": 0.9, "ap news": 0.9, "benzinga": 0.85,
    "cnbc": 0.85, "dow jones": 0.9, "marketwatch": 0.8, "barron's": 0.85, "the new york times": 0.85,
    "yahoo finance": 0.75, "fortune": 0.75, "business insider": 0.7, "axios": 0.75,
    "investing.com": 0.65, "seeking alpha": 0.6, "the motley fool": 0.5, "motley fool": 0.5,
    "zacks": 0.5, "zacks investment research": 0.5, "insidermonkey": 0.45, "gurufocus": 0.45,
    "finnhub": 0.7,
    # press-release wires: primary source, but self-promotional
    "pr newswire": 0.7, "globenewswire": 0.7, "business wire": 0.7, "accesswire": 0.55,
}


def source_weight(source: Optional[str]) -> float:
    if not source:
        return 0.6
    return SOURCE_WEIGHTS.get(source.strip().lower(), 0.6)


def cap_reach(market_caps: Iterable[Optional[float]], categories: Iterable[str] = ()) -> float:
    caps = [c for c in market_caps if c and c > 0]
    if not caps:
        return 0.75 if set(categories) & MARKET_WIDE else 0.4
    x = (math.log10(max(caps)) - 8.0) / 4.5
    return 0.3 + 0.7 * min(1.0, max(0.0, x))


def recency(published_at: Optional[datetime], now: Optional[datetime] = None) -> float:
    if published_at is None:
        return 0.5
    now = now or datetime.now(timezone.utc)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    age_h = max(0.0, (now - published_at).total_seconds() / 3600.0)
    return max(0.05, 0.5 ** (age_h / 6.0))


def corroboration(n_sources: int) -> float:
    n = max(1, int(n_sources or 1))
    return min(1.0, 0.6 + 0.4 * math.log2(1 + n) / math.log2(9))


def impact_score(
    *,
    sentiment_score: float,
    sentiment_confidence: float,
    source: Optional[str],
    market_caps: Iterable[Optional[float]] = (),
    categories: Iterable[str] = (),
    published_at: Optional[datetime] = None,
    n_sources: int = 1,
    now: Optional[datetime] = None,
) -> int:
    cats = list(categories)
    s = 0.2 + 0.8 * min(1.0, abs(sentiment_score or 0.0)) * min(1.0, max(0.0, sentiment_confidence or 0.0))
    val = (
        100.0
        * s
        * source_weight(source)
        * cap_reach(market_caps, cats)
        * recency(published_at, now)
        * corroboration(n_sources)
    )
    return int(max(0, min(100, round(val))))
