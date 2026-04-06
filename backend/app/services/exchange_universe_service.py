"""
Exchange Universe Batch Ingestion Service
=========================================
Manages a ranked stock universe across 12 global exchanges using FMP screener.

Priority score formula:
  0.35 * normalized_market_cap
+ 0.35 * normalized_dollar_volume
+ 0.15 * index_membership_weight
+ 0.10 * analyst_coverage
+ 0.05 * user_interest

Scheduled jobs (APScheduler):
  - nightly_sync: refresh symbol list + priority scores (00:30 UTC)
  - hourly_quotes: update price/change_percent/volume (every 30 min during market hours)
  - weekly_cleanup: remove delisted / stale symbols (Sunday 03:00 UTC)
"""

import httpx
import logging
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session
from app.config import settings
from app.models.exchange_ranked_symbol import ExchangeRankedSymbol

logger = logging.getLogger(__name__)

# ── Exchange universe targets ──────────────────────────────────────────────────
EXCHANGE_TARGETS = {
    "us":        {"fmp": ["NYSE", "NASDAQ", "AMEX"],         "limit": 300, "country": "United States"},
    "india":     {"fmp": ["NSE", "BSE"],                     "limit": 100, "country": "India"},
    "uk":        {"fmp": ["LON"],                             "limit": 75,  "country": "United Kingdom"},
    "canada":    {"fmp": ["TSX", "TSXV"],                    "limit": 50,  "country": "Canada"},
    "germany":   {"fmp": ["XETRA", "FRA"],                   "limit": 50,  "country": "Germany"},
    "france":    {"fmp": ["PAR"],                             "limit": 40,  "country": "France"},
    "japan":     {"fmp": ["JPX", "TSE"],                     "limit": 50,  "country": "Japan"},
    "hongkong":  {"fmp": ["HKSE"],                           "limit": 40,  "country": "Hong Kong"},
    "china":     {"fmp": ["SHH", "SHZ"],                     "limit": 40,  "country": "China"},
    "korea":     {"fmp": ["KSC", "KOSDAQ"],                  "limit": 20,  "country": "South Korea"},
    "australia": {"fmp": ["ASX"],                             "limit": 20,  "country": "Australia"},
    "brazil":    {"fmp": ["SAO"],                             "limit": 15,  "country": "Brazil"},
}

# Major index membership (symbol → weight). Extend as needed.
INDEX_MEMBERS: dict[str, float] = {
    # S&P 500 flagship names
    "AAPL": 1.0, "MSFT": 1.0, "NVDA": 1.0, "GOOGL": 1.0, "META": 1.0,
    "AMZN": 1.0, "TSLA": 1.0, "AVGO": 1.0, "JPM": 1.0, "V": 1.0,
    # Nifty 50
    "RELIANCE.NS": 1.0, "TCS.NS": 1.0, "HDFCBANK.NS": 1.0, "INFY.NS": 1.0,
    # FTSE 100
    "AZN.L": 1.0, "SHEL.L": 1.0, "HSBA.L": 1.0, "BP.L": 1.0,
    # Nikkei 225
    "7203.T": 1.0, "6758.T": 1.0, "9984.T": 1.0,
    # Hang Seng
    "0700.HK": 1.0, "0005.HK": 1.0, "0941.HK": 1.0,
}


def _normalize(values: list[float]) -> list[float]:
    """Min-max normalize a list of floats to [0, 1]."""
    if not values:
        return []
    mn, mx = min(values), max(values)
    rng = mx - mn
    if rng == 0:
        return [0.5] * len(values)
    return [(v - mn) / rng for v in values]


def compute_priority_score(
    norm_market_cap: float,
    norm_dollar_volume: float,
    index_weight: float = 0.0,
    analyst_coverage: float = 0.0,
    user_interest: float = 0.0,
) -> float:
    return (
        0.35 * norm_market_cap
        + 0.35 * norm_dollar_volume
        + 0.15 * index_weight
        + 0.10 * analyst_coverage
        + 0.05 * user_interest
    )


# ── FMP screener ───────────────────────────────────────────────────────────────
def fetch_fmp_screener(exchanges: list[str], limit: int) -> list[dict]:
    if not settings.FMP_API_KEY:
        logger.warning("FMP_API_KEY not set — skipping screener fetch")
        return []
    exchange_param = ",".join(exchanges)
    url = (
        f"https://financialmodelingprep.com/api/v3/stock-screener"
        f"?exchange={exchange_param}&marketCapMoreThan=100000000"
        f"&isActivelyTrading=true&limit={min(limit * 2, 500)}"
        f"&sortBy=marketCap&sortOrder=desc&apikey={settings.FMP_API_KEY}"
    )
    try:
        with httpx.Client(timeout=30) as client:
            r = client.get(url)
            r.raise_for_status()
            data = r.json()
            if not isinstance(data, list):
                return []
            return data[:limit]
    except Exception as e:
        logger.error(f"FMP screener error: {e}")
        return []


# ── Nightly sync ───────────────────────────────────────────────────────────────
def sync_exchange_universe(db: Session, exchange_key: str) -> int:
    """
    Fetch top N stocks for an exchange from FMP, compute priority scores,
    upsert into exchange_ranked_symbols. Returns count of upserted rows.
    """
    cfg = EXCHANGE_TARGETS.get(exchange_key)
    if not cfg:
        logger.warning(f"Unknown exchange_key: {exchange_key}")
        return 0

    rows = fetch_fmp_screener(cfg["fmp"], cfg["limit"])
    if not rows:
        logger.warning(f"No rows returned for {exchange_key}")
        return 0

    # Compute normalizations
    market_caps = [float(r.get("marketCap") or 0) for r in rows]
    # dollar_volume = price * volume
    dollar_vols = [
        float(r.get("price") or 0) * float(r.get("volume") or 0)
        for r in rows
    ]

    norm_mc = _normalize(market_caps)
    norm_dv = _normalize(dollar_vols)

    upsert_count = 0
    for i, row in enumerate(rows):
        symbol = str(row.get("symbol") or "").strip()
        if not symbol:
            continue

        index_w = INDEX_MEMBERS.get(symbol, 0.0)
        score = compute_priority_score(
            norm_market_cap=norm_mc[i],
            norm_dollar_volume=norm_dv[i],
            index_weight=index_w,
        )

        existing = (
            db.query(ExchangeRankedSymbol)
            .filter(
                ExchangeRankedSymbol.symbol == symbol,
                ExchangeRankedSymbol.exchange_key == exchange_key,
            )
            .first()
        )

        if existing:
            existing.name = str(row.get("companyName") or symbol)
            existing.sector = str(row.get("sector") or "Other")
            existing.industry = str(row.get("industry") or "")
            existing.market_cap = market_caps[i]
            existing.dollar_volume = dollar_vols[i]
            existing.index_membership_weight = index_w
            existing.priority_score = score
            existing.rank_in_exchange = i + 1
            existing.price = float(row.get("price") or 0)
            existing.change_percent = float(row.get("changePercentage") or 0)
            existing.volume = float(row.get("volume") or 0)
            existing.is_active = True
            existing.updated_at = datetime.now(timezone.utc)
        else:
            obj = ExchangeRankedSymbol(
                symbol=symbol,
                name=str(row.get("companyName") or symbol),
                exchange=cfg["fmp"][0],
                exchange_key=exchange_key,
                country=cfg.get("country", ""),
                currency=str(row.get("currency") or "USD"),
                sector=str(row.get("sector") or "Other"),
                industry=str(row.get("industry") or ""),
                market_cap=market_caps[i],
                dollar_volume=dollar_vols[i],
                index_membership_weight=index_w,
                priority_score=score,
                rank_in_exchange=i + 1,
                price=float(row.get("price") or 0),
                change_percent=float(row.get("changePercentage") or 0),
                volume=float(row.get("volume") or 0),
            )
            db.add(obj)
        upsert_count += 1

    db.commit()
    logger.info(f"Synced {upsert_count} symbols for {exchange_key}")
    return upsert_count


def sync_all_exchanges(db: Session) -> dict:
    results = {}
    for key in EXCHANGE_TARGETS:
        try:
            results[key] = sync_exchange_universe(db, key)
        except Exception as e:
            logger.error(f"Failed to sync {key}: {e}")
            results[key] = -1
    return results


# ── Weekly cleanup ─────────────────────────────────────────────────────────────
def cleanup_stale_symbols(db: Session, days_threshold: int = 30) -> int:
    """Mark symbols not updated in N days as inactive."""
    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_threshold)
    # SQLAlchemy doesn't compare naive/aware easily — use naive UTC
    cutoff_naive = cutoff.replace(tzinfo=None)
    count = (
        db.query(ExchangeRankedSymbol)
        .filter(
            ExchangeRankedSymbol.updated_at < cutoff_naive,
            ExchangeRankedSymbol.is_active == True,
        )
        .update({"is_active": False})
    )
    db.commit()
    logger.info(f"Marked {count} stale symbols as inactive")
    return count
