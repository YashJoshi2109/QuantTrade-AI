"""
Stock screener: metric snapshot builder, query parsing/validation and SQL filtering.

Data flow
---------
rebuild_snapshot(db) reads only what is already in our DB and writes one
``screener_snapshots`` row per symbol:

  * symbols                -> name, exchange, asset type, sector fallback, market cap fallback
  * fundamentals           -> valuation / margins / ROE / D/E / dividend yield
                              (run through fundamental_units so finviz percents and
                              yfinance ratios end up in the same units)
  * financial_statements   -> revenue growth YoY (latest fiscal quarter vs the same quarter a
                              year earlier) and SEC fallbacks for P/S, margin, ROE, D/E
  * price_bars (daily)     -> SMA 50/200, RSI(14), 1-month change, 1-day change fallback
  * quote_snapshots        -> latest price and day change when newer than the last bar

Everything is fetched in a few bulk queries per chunk of symbols (no per-symbol
queries). The API reads the snapshot with one filtered/sorted/paginated SELECT
plus one COUNT. The snapshot is refreshed lazily: an empty table is built inline,
a stale one (> SNAPSHOT_TTL) is rebuilt in a background thread while the old
rows keep serving.

Missing data is NULL, never 0. Values outside sanity bounds are dropped to NULL
and recorded in ``flags`` (e.g. ``roe_outlier``) instead of being shown.

No external API calls and no LLM use.
"""
from __future__ import annotations

import logging
import math
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, func, or_, select, text
from sqlalchemy.orm import Session

from app.models.screener_snapshot import ScreenerSnapshot

logger = logging.getLogger("screener")

SNAPSHOT_TTL = timedelta(minutes=15)
CHUNK = 400
BARS_NEEDED = 220          # 200-day SMA plus slack
ET = ZoneInfo("America/New_York")

# ── sanity bounds: value outside -> NULL + flag ─────────────────────────────────
# (low, high, flag). Bounds are inclusive.
BOUNDS: Dict[str, Tuple[float, float, str]] = {
    "pe_ratio": (0.0, 1000.0, "pe_outlier"),
    "ps_ratio": (0.0, 1000.0, "ps_outlier"),
    "dividend_yield_pct": (0.0, 30.0, "dividend_yield_outlier"),
    "revenue_growth_yoy_pct": (-100.0, 1000.0, "revenue_growth_outlier"),
    "profit_margin_pct": (-1000.0, 100.0, "margin_outlier"),
    "roe_pct": (-1000.0, 1000.0, "roe_outlier"),
    "debt_to_equity": (0.0, 100.0, "debt_to_equity_outlier"),
    "change_1d_pct": (-100.0, 1000.0, "change_outlier"),
    "change_1m_pct": (-100.0, 5000.0, "change_outlier"),
    "market_cap": (0.0, 1e14, "market_cap_outlier"),
}


def _f(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _bounded(key: str, v: Optional[float], flags: List[str]) -> Optional[float]:
    if v is None:
        return None
    lo, hi, flag = BOUNDS[key]
    if v < lo or v > hi:
        if flag not in flags:
            flags.append(flag)
        return None
    return round(v, 4)


# ── technicals from daily closes (pure) ─────────────────────────────────────────

def sma(closes: Sequence[float], n: int) -> Optional[float]:
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n


def rsi(closes: Sequence[float], period: int = 14) -> Optional[float]:
    """RSI with simple rolling means, same formula as IndicatorService.compute_rsi
    (and therefore the RSI alerts), so screener and alerts agree."""
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(len(closes) - period, len(closes))]
    gain = sum(d for d in deltas if d > 0) / period
    loss = sum(-d for d in deltas if d < 0) / period
    if loss == 0:
        return None if gain == 0 else 100.0
    return 100 - 100 / (1 + gain / loss)


def pct_change(new: Optional[float], old: Optional[float]) -> Optional[float]:
    if new is None or old is None or old <= 0:
        return None
    return (new / old - 1) * 100


def _et_date(ts: Optional[datetime]):
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(ET).date()


def _parse_ts(v: Any) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str) and v:
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def technicals(bars: Sequence[Tuple[datetime, float]], quote: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """bars: (timestamp, close) ascending. quote: cached quote payload (price, change_percent,
    market_time/timestamp). The quote's price is used as today's close when it is newer than
    the last bar (appended for a new session, replacing the last close on the same session)."""
    # one close per ET session (keep the last), in date order
    by_day: Dict[Any, Tuple[datetime, float]] = {}
    for ts, c in bars:
        c = _f(c)
        if c is None or c <= 0:
            continue
        by_day[_et_date(ts)] = (ts, c)
    days = sorted(by_day)
    closes = [by_day[d][1] for d in days]
    last_ts = by_day[days[-1]][0] if days else None

    price = closes[-1] if closes else None
    price_as_of = last_ts
    change_1d = pct_change(closes[-1], closes[-2]) if len(closes) >= 2 else None

    q_price = _f((quote or {}).get("price"))
    if q_price is not None and q_price > 0 and not (quote or {}).get("unavailable"):
        q_ts = _parse_ts((quote or {}).get("market_time")) or _parse_ts((quote or {}).get("timestamp"))
        q_day = _et_date(q_ts)
        if q_day is not None and (not days or q_day >= days[-1]):
            if days and q_day == days[-1]:
                closes[-1] = q_price
            else:
                closes.append(q_price)
            price, price_as_of = q_price, q_ts
            qc = _f((quote or {}).get("change_percent"))
            if qc is None:
                qc = pct_change(q_price, _f((quote or {}).get("previous_close")))
            if qc is None and len(closes) >= 2:
                qc = pct_change(closes[-1], closes[-2])
            change_1d = qc

    s50, s200 = sma(closes, 50), sma(closes, 200)
    return {
        "price": price,
        "price_as_of": price_as_of,
        "change_1d_pct": change_1d,
        # 21 trading sessions ~ one calendar month
        "change_1m_pct": pct_change(closes[-1], closes[-22]) if len(closes) >= 22 else None,
        "rsi_14": rsi(closes, 14),
        "sma_50": s50,
        "sma_200": s200,
        "price_vs_sma50_pct": pct_change(price, s50),
        "price_vs_sma200_pct": pct_change(price, s200),
    }


# ── fundamentals + SEC statements (pure) ────────────────────────────────────────

def statement_metrics(ticker: str, rows: Sequence[Mapping[str, Any]]) -> Dict[str, Optional[float]]:
    """Revenue growth YoY and TTM figures from SEC financial_statements rows."""
    from app.services.copilot.sources import statement_periods

    out: Dict[str, Optional[float]] = {"revenue_growth_yoy_pct": None, "ttm_revenue": None,
                                       "ttm_net_income": None, "equity": None, "long_term_debt": None}
    if not rows:
        return out
    try:
        periods = statement_periods(ticker, list(rows), n_quarters=8, n_annual=2)
    except Exception as e:  # malformed XBRL row: skip the SEC part for this symbol
        logger.debug("statement_periods failed for %s: %s", ticker, e)
        return out
    quarters = [p for p in periods if p.fiscal_quarter]
    annuals = [p for p in periods if not p.fiscal_quarter]
    if quarters:
        out["revenue_growth_yoy_pct"] = _f(quarters[0].revenue_yoy_pct)
    elif annuals:
        out["revenue_growth_yoy_pct"] = _f(annuals[0].revenue_yoy_pct)

    # TTM = four consecutive fiscal quarters, else the latest fiscal year
    last4 = quarters[:4]

    def _consecutive(qs) -> bool:
        if len(qs) < 4:
            return False
        for a, b in zip(qs, qs[1:]):
            expect = (a.fiscal_year, a.fiscal_quarter - 1) if a.fiscal_quarter > 1 else (a.fiscal_year - 1, 4)
            if (b.fiscal_year, b.fiscal_quarter) != expect:
                return False
        return True

    if _consecutive(last4) and all(q.revenue is not None for q in last4):
        out["ttm_revenue"] = sum(q.revenue for q in last4)
        if all(q.net_income is not None for q in last4):
            out["ttm_net_income"] = sum(q.net_income for q in last4)
    elif annuals:
        out["ttm_revenue"] = _f(annuals[0].revenue)
        out["ttm_net_income"] = _f(annuals[0].net_income)
    latest = quarters[0] if quarters else (annuals[0] if annuals else None)
    if latest is not None:
        out["equity"] = _f(latest.stockholders_equity)
        out["long_term_debt"] = _f(latest.long_term_debt)
    return out


def fundamental_metrics(fund: Optional[Mapping[str, Any]], sec: Mapping[str, Optional[float]],
                        price: Optional[float], market_cap: Optional[float], flags: List[str]) -> Dict[str, Optional[float]]:
    """Screener fundamentals: fundamentals table first (unit-normalised), SEC fallbacks."""
    from app.services.fundamental_units import normalize_fundamental_units

    f = normalize_fundamental_units(fund or {})
    rev, ni = sec.get("ttm_revenue"), sec.get("ttm_net_income")
    equity, ltd = sec.get("equity"), sec.get("long_term_debt")

    pe = _f(f.get("pe_ratio"))
    eps = _f(f.get("eps"))
    if pe is None and eps is not None and price:
        pe = price / eps if eps > 0 else None
    if (pe is not None and pe <= 0) or (eps is not None and eps < 0) or (pe is None and ni is not None and ni < 0):
        if "negative_earnings" not in flags:
            flags.append("negative_earnings")
        pe = None

    ps = _f(f.get("price_to_sales"))
    if ps is None and market_cap and rev and rev > 0:
        ps = market_cap / rev

    margin = _f(f.get("profit_margin"))
    if margin is None and rev and rev > 0 and ni is not None:
        margin = ni / rev * 100

    roe = _f(f.get("roe"))
    de = _f(f.get("debt_to_equity"))
    if equity is not None and equity <= 0:
        # negative book equity makes ROE and D/E meaningless
        if "negative_equity" not in flags:
            flags.append("negative_equity")
        roe = None
        de = None
    else:
        if roe is None and equity and ni is not None:
            roe = ni / equity * 100
        if de is None and equity and ltd is not None:
            de = ltd / equity

    growth = sec.get("revenue_growth_yoy_pct")
    if growth is None:
        growth = _f(f.get("quarterly_revenue_growth"))

    return {
        "pe_ratio": _bounded("pe_ratio", pe, flags),
        "ps_ratio": _bounded("ps_ratio", ps, flags),
        "dividend_yield_pct": _bounded("dividend_yield_pct", _f(f.get("dividend_yield")), flags),
        "revenue_growth_yoy_pct": _bounded("revenue_growth_yoy_pct", growth, flags),
        "profit_margin_pct": _bounded("profit_margin_pct", margin, flags),
        "roe_pct": _bounded("roe_pct", roe, flags),
        "debt_to_equity": _bounded("debt_to_equity", de, flags),
    }


# Providers disagree on sector names (yfinance/finviz vs our GICS-style seed list).
# Canonicalise so one sector filter catches every row.
SECTOR_ALIASES = {
    "financials": "Financial Services", "financial": "Financial Services", "financial services": "Financial Services",
    "consumer": "Consumer Cyclical", "consumer discretionary": "Consumer Cyclical", "consumer cyclical": "Consumer Cyclical",
    "consumer staples": "Consumer Defensive", "consumer defensive": "Consumer Defensive",
    "communication": "Communication Services", "communications": "Communication Services",
    "communication services": "Communication Services", "telecommunication services": "Communication Services",
    "materials": "Basic Materials", "basic materials": "Basic Materials",
    "health care": "Healthcare", "healthcare": "Healthcare",
    "information technology": "Technology", "technology": "Technology",
    "industrials": "Industrials", "energy": "Energy", "utilities": "Utilities", "real estate": "Real Estate",
}
NON_SECTORS = {"etf", "fund", "n/a", "none", "unknown", "-"}


def canonical_sector(raw: Any) -> Optional[str]:
    if not isinstance(raw, str) or not raw.strip():
        return None
    k = raw.strip().lower()
    if k in NON_SECTORS:
        return None
    return SECTOR_ALIASES.get(k, raw.strip()[:100])


FUND_COLS = ("company_name", "sector", "industry", "market_cap", "pe_ratio", "price_to_sales", "dividend_yield",
             "profit_margin", "operating_margin", "gross_margin", "roa", "roe", "debt_to_equity", "eps",
             "quarterly_revenue_growth")
FS_COLS = ("symbol_id", "period", "form", "fiscal_year", "fiscal_quarter", "period_end_date", "filed_date",
           "revenue", "gross_profit", "operating_income", "net_income", "eps_diluted", "operating_cash_flow",
           "capital_expenditures", "free_cash_flow", "total_assets", "total_liabilities", "long_term_debt",
           "cash_and_equivalents", "stockholders_equity", "shares_diluted")


def build_row(sym: Mapping[str, Any], fund: Optional[Mapping[str, Any]], fs_rows: Sequence[Mapping[str, Any]],
              bars: Sequence[Tuple[datetime, float]], quote: Optional[Mapping[str, Any]],
              now: datetime) -> Optional[Dict[str, Any]]:
    """One snapshot row, or None when we have neither a price nor a market cap."""
    flags: List[str] = []
    tech = technicals(bars, quote)
    fund = fund or {}
    mcap = _f(fund.get("market_cap"))
    if mcap is None or mcap <= 0:
        mcap = _f(sym.get("market_cap"))
    mcap = _bounded("market_cap", mcap if mcap and mcap > 0 else None, flags)
    if tech["price"] is None and mcap is None:
        return None
    sec = statement_metrics(sym["symbol"], fs_rows)
    fm = fundamental_metrics(fund, sec, tech["price"], mcap, flags)
    r = lambda v, n=4: None if v is None else round(v, n)  # noqa: E731
    rsi_v = tech["rsi_14"]
    return {
        "symbol_id": sym["id"],
        "symbol": sym["symbol"],
        "name": (fund.get("company_name") or sym.get("name") or "").strip() or None,
        "sector": canonical_sector(fund.get("sector")) or canonical_sector(sym.get("sector")),
        "industry": fund.get("industry") or sym.get("industry") or None,
        "exchange": sym.get("exchange"),
        "asset_type": sym.get("asset_type") or "Equity",
        "price": r(tech["price"]),
        "change_1d_pct": _bounded("change_1d_pct", tech["change_1d_pct"], flags),
        "change_1m_pct": _bounded("change_1m_pct", tech["change_1m_pct"], flags),
        "market_cap": mcap,
        **fm,
        "rsi_14": r(rsi_v, 2) if rsi_v is not None and 0 <= rsi_v <= 100 else None,
        "sma_50": r(tech["sma_50"]),
        "sma_200": r(tech["sma_200"]),
        "price_vs_sma50_pct": r(tech["price_vs_sma50_pct"]),
        "price_vs_sma200_pct": r(tech["price_vs_sma200_pct"]),
        "flags": ",".join(flags) or None,
        "price_as_of": tech["price_as_of"],
        "computed_at": now,
    }


# ── snapshot build (bulk queries, chunked) ──────────────────────────────────────

def _load_chunk(db: Session, syms: List[Dict[str, Any]], since_date: str):
    from app.models.edgar import FinancialStatement
    from app.models.fundamentals import Fundamentals
    from app.models.price import PriceBar
    from app.models.quote_snapshot import QuoteSnapshot

    ids = [s["id"] for s in syms]
    funds: Dict[int, Dict[str, Any]] = {}
    for row in db.query(Fundamentals.symbol_id, *[getattr(Fundamentals, c) for c in FUND_COLS]).filter(
            Fundamentals.symbol_id.in_(ids)):
        funds[row[0]] = dict(zip(FUND_COLS, row[1:]))

    fs: Dict[int, List[Dict[str, Any]]] = {}
    for row in db.query(*[getattr(FinancialStatement, c) for c in FS_COLS]).filter(
            FinancialStatement.symbol_id.in_(ids), FinancialStatement.period_end_date >= since_date):
        d = dict(zip(FS_COLS, row))
        fs.setdefault(d["symbol_id"], []).append(d)

    rn = func.row_number().over(partition_by=PriceBar.symbol_id, order_by=PriceBar.timestamp.desc()).label("rn")
    sub = (select(PriceBar.symbol_id, PriceBar.timestamp, PriceBar.close, rn)
           .where(PriceBar.symbol_id.in_(ids)).subquery())
    bars: Dict[int, List[Tuple[datetime, float]]] = {}
    for sid, ts, close in db.execute(select(sub.c.symbol_id, sub.c.timestamp, sub.c.close)
                                     .where(sub.c.rn <= BARS_NEEDED)):
        bars.setdefault(sid, []).append((ts, close))
    for v in bars.values():
        v.sort(key=lambda t: t[0])

    tickers = [s["symbol"] for s in syms]
    quotes: Dict[str, Dict[str, Any]] = {}
    for sym, payload, fetched in db.query(QuoteSnapshot.symbol, QuoteSnapshot.payload, QuoteSnapshot.fetched_at).filter(
            QuoteSnapshot.symbol.in_(tickers)):
        if isinstance(payload, dict):
            p = dict(payload)
            p.setdefault("timestamp", fetched.isoformat() if fetched else None)
            quotes[sym] = p
    return funds, fs, bars, quotes


def compute_rows(db: Session, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    from app.models.symbol import Symbol

    now = now or datetime.now(timezone.utc)
    since = (now - timedelta(days=3 * 365)).date().isoformat()
    cols = (Symbol.id, Symbol.symbol, Symbol.name, Symbol.exchange, Symbol.asset_type, Symbol.sector,
            Symbol.industry, Symbol.market_cap)
    keys = ("id", "symbol", "name", "exchange", "asset_type", "sector", "industry", "market_cap")
    from app.services.ticker_lifecycle import inactive_symbols

    retired = inactive_symbols(db)  # renamed / acquired / delisted never screen
    all_syms = [dict(zip(keys, r)) for r in db.query(*cols).order_by(Symbol.id)
                if (r[1] or "").upper() not in retired]
    out: List[Dict[str, Any]] = []
    for i in range(0, len(all_syms), CHUNK):
        chunk = all_syms[i:i + CHUNK]
        funds, fs, bars, quotes = _load_chunk(db, chunk, since)
        for s in chunk:
            try:
                row = build_row(s, funds.get(s["id"]), fs.get(s["id"], []), bars.get(s["id"], []),
                                quotes.get(s["symbol"]), now)
            except Exception as e:  # one bad symbol must not sink the whole snapshot
                logger.warning("screener row failed for %s: %s", s["symbol"], e)
                continue
            if row:
                out.append(row)
    return out


def rebuild_snapshot(db: Session, now: Optional[datetime] = None) -> int:
    """Recompute every row and swap them in one transaction (readers keep the old rows until commit)."""
    rows = compute_rows(db, now)
    db.query(ScreenerSnapshot).delete(synchronize_session=False)
    if rows:
        db.bulk_insert_mappings(ScreenerSnapshot, rows)
    db.commit()
    logger.info("screener snapshot rebuilt: %d rows", len(rows))
    return len(rows)


_rebuild_lock = threading.Lock()


def _rebuild_in_own_session() -> None:
    from app.db.database import SessionLocal

    if SessionLocal is None:
        return
    db = SessionLocal()
    try:
        rebuild_snapshot(db)
    except Exception as e:
        logger.warning("screener background rebuild failed: %s", e)
        db.rollback()
    finally:
        db.close()
        _rebuild_lock.release()


def _spawn_refresh() -> bool:
    if not _rebuild_lock.acquire(blocking=False):
        return False  # a rebuild is already running
    threading.Thread(target=_rebuild_in_own_session, name="screener-rebuild", daemon=True).start()
    return True


def snapshot_state(db: Session) -> Tuple[int, Optional[datetime]]:
    n, as_of = db.query(func.count(ScreenerSnapshot.id), func.max(ScreenerSnapshot.computed_at)).one()
    if as_of is not None and as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=timezone.utc)
    return int(n or 0), as_of


def ensure_fresh(db: Session, now: Optional[datetime] = None) -> Tuple[int, Optional[datetime], bool]:
    """Returns (rows, as_of, refreshing). Builds inline when empty; refreshes in the background when stale."""
    now = now or datetime.now(timezone.utc)
    n, as_of = snapshot_state(db)
    if n == 0:
        with _rebuild_lock:
            n, as_of = snapshot_state(db)
            if n == 0:
                rebuild_snapshot(db, now)
                n, as_of = snapshot_state(db)
        return n, as_of, False
    refreshing = False
    if as_of is None or now - as_of > SNAPSHOT_TTL:
        refreshing = _spawn_refresh()
    return n, as_of, refreshing


# ── query spec: filters, presets, sort ──────────────────────────────────────────

@dataclass(frozen=True)
class RangeFilter:
    key: str          # query param prefix: ?{key}_min=&{key}_max=
    column: str       # ScreenerSnapshot column
    label: str
    unit: str         # "$B", "%", "x", ""
    lo: float
    hi: float
    scale: float = 1.0  # param value * scale == column value (market cap is given in $B)


RANGE_FILTERS: Tuple[RangeFilter, ...] = (
    RangeFilter("mcap", "market_cap", "Market cap", "$B", 0, 100_000, 1e9),
    RangeFilter("price", "price", "Price", "$", 0, 1_000_000),
    RangeFilter("pe", "pe_ratio", "P/E", "x", 0, 1000),
    RangeFilter("ps", "ps_ratio", "P/S", "x", 0, 1000),
    RangeFilter("div_yield", "dividend_yield_pct", "Dividend yield", "%", 0, 30),
    RangeFilter("rev_growth", "revenue_growth_yoy_pct", "Revenue growth YoY", "%", -100, 1000),
    RangeFilter("margin", "profit_margin_pct", "Profit margin", "%", -1000, 100),
    RangeFilter("roe", "roe_pct", "ROE", "%", -1000, 1000),
    RangeFilter("de", "debt_to_equity", "Debt / equity", "x", 0, 100),
    RangeFilter("rsi", "rsi_14", "RSI (14)", "", 0, 100),
    RangeFilter("chg1d", "change_1d_pct", "1D change", "%", -100, 1000),
    RangeFilter("chg1m", "change_1m_pct", "1M change", "%", -100, 5000),
)
RANGE_BY_KEY = {f.key: f for f in RANGE_FILTERS}
SMA_FILTERS = {"sma50": "price_vs_sma50_pct", "sma200": "price_vs_sma200_pct"}
SMA_VALUES = ("above", "below")

SORT_FIELDS: Dict[str, str] = {
    "symbol": "symbol", "name": "name", "sector": "sector", "price": "price",
    "change_1d": "change_1d_pct", "change_1m": "change_1m_pct", "market_cap": "market_cap",
    "pe": "pe_ratio", "ps": "ps_ratio", "dividend_yield": "dividend_yield_pct",
    "revenue_growth": "revenue_growth_yoy_pct", "profit_margin": "profit_margin_pct", "roe": "roe_pct",
    "debt_to_equity": "debt_to_equity", "rsi": "rsi_14", "vs_sma50": "price_vs_sma50_pct",
    "vs_sma200": "price_vs_sma200_pct",
}

MAX_LIMIT = 100
MAX_OFFSET = 10_000
MAX_SECTORS = 15
SECTOR_RE = re.compile(r"^[A-Za-z0-9 &,.'/\-]{1,100}$")
Q_RE = re.compile(r"^[A-Za-z0-9 .&'\-]{1,40}$")


@dataclass(frozen=True)
class Preset:
    id: str
    label: str
    description: str
    params: Dict[str, str]


PRESETS: Tuple[Preset, ...] = (
    Preset("value", "Value", "Low P/E and P/S with manageable debt.",
           {"pe_max": "15", "ps_max": "3", "de_max": "1.5", "sort": "pe", "order": "asc"}),
    Preset("growth", "Growth", "Revenue up 20%+ year over year.",
           {"rev_growth_min": "20", "sort": "revenue_growth", "order": "desc"}),
    Preset("dividend", "Dividend", "Yield of 3%+ from companies worth $2B or more.",
           {"div_yield_min": "3", "mcap_min": "2", "sort": "dividend_yield", "order": "desc"}),
    Preset("quality", "Quality", "ROE 15%+, profit margin 15%+, debt/equity under 1.",
           {"roe_min": "15", "margin_min": "15", "de_max": "1", "sort": "roe", "order": "desc"}),
    Preset("oversold", "Oversold (RSI<30)", "RSI(14) at or below 30.",
           {"rsi_max": "30", "sort": "rsi", "order": "asc"}),
    Preset("momentum", "Momentum", "Above the 50- and 200-day averages and up 5%+ over a month.",
           {"sma50": "above", "sma200": "above", "chg1m_min": "5", "sort": "change_1m", "order": "desc"}),
)
PRESET_BY_ID = {p.id: p for p in PRESETS}


@dataclass
class ScreenQuery:
    ranges: Dict[str, Tuple[Optional[float], Optional[float]]] = field(default_factory=dict)  # key -> (min, max)
    sectors: List[str] = field(default_factory=list)
    sma: Dict[str, str] = field(default_factory=dict)   # sma50/sma200 -> above|below
    q: Optional[str] = None
    include_etfs: bool = False
    preset: Optional[str] = None
    sort: str = "market_cap"
    order: str = "desc"
    limit: int = 50
    offset: int = 0

    def applied(self) -> Dict[str, Any]:
        """Effective filters, echoed back to the client."""
        out: Dict[str, Any] = {}
        for k, (lo, hi) in self.ranges.items():
            if lo is not None:
                out[f"{k}_min"] = lo
            if hi is not None:
                out[f"{k}_max"] = hi
        if self.sectors:
            out["sector"] = self.sectors
        out.update(self.sma)
        if self.q:
            out["q"] = self.q
        if self.include_etfs:
            out["include_etfs"] = True
        return out


class ScreenError(ValueError):
    pass


def _num(name: str, raw: str) -> float:
    try:
        v = float(raw)
    except (TypeError, ValueError):
        raise ScreenError(f"{name} must be a number")
    if not math.isfinite(v):
        raise ScreenError(f"{name} must be a finite number")
    return v


def _int(name: str, raw: str, lo: int, hi: int) -> int:
    try:
        v = int(raw)
    except (TypeError, ValueError):
        raise ScreenError(f"{name} must be an integer")
    if not lo <= v <= hi:
        raise ScreenError(f"{name} must be between {lo} and {hi}")
    return v


def parse_screen(params: Mapping[str, str]) -> ScreenQuery:
    """Validate query params. Unknown params are ignored; bad values raise ScreenError.
    A preset supplies defaults; explicit params override them."""
    p = {k: v.strip() for k, v in params.items() if isinstance(v, str) and v.strip() != ""}
    sq = ScreenQuery()
    if "preset" in p:
        preset = PRESET_BY_ID.get(p["preset"])
        if preset is None:
            raise ScreenError(f"unknown preset; use one of: {', '.join(PRESET_BY_ID)}")
        sq.preset = preset.id
        p = {**preset.params, **p}

    for f in RANGE_FILTERS:
        lo_raw, hi_raw = p.get(f"{f.key}_min"), p.get(f"{f.key}_max")
        lo = _num(f"{f.key}_min", lo_raw) if lo_raw is not None else None
        hi = _num(f"{f.key}_max", hi_raw) if hi_raw is not None else None
        for name, v in ((f"{f.key}_min", lo), (f"{f.key}_max", hi)):
            if v is not None and not f.lo <= v <= f.hi:
                raise ScreenError(f"{name} must be between {f.lo:g} and {f.hi:g}")
        if lo is not None and hi is not None and lo > hi:
            raise ScreenError(f"{f.key}_min must be less than or equal to {f.key}_max")
        if lo is not None or hi is not None:
            sq.ranges[f.key] = (lo, hi)

    if "sector" in p:
        sectors = [s.strip() for s in p["sector"].split("|") if s.strip()]
        if len(sectors) > MAX_SECTORS:
            raise ScreenError(f"at most {MAX_SECTORS} sectors")
        for s in sectors:
            if not SECTOR_RE.match(s):
                raise ScreenError("invalid sector")
        sq.sectors = sorted(set(sectors))

    for key in SMA_FILTERS:
        if key in p:
            if p[key] not in SMA_VALUES:
                raise ScreenError(f"{key} must be 'above' or 'below'")
            sq.sma[key] = p[key]

    if "q" in p:
        if not Q_RE.match(p["q"]):
            raise ScreenError("q may contain letters, digits, spaces and . & ' - (max 40)")
        sq.q = p["q"]

    if "include_etfs" in p:
        if p["include_etfs"].lower() not in ("1", "true", "0", "false"):
            raise ScreenError("include_etfs must be true or false")
        sq.include_etfs = p["include_etfs"].lower() in ("1", "true")

    if "sort" in p:
        if p["sort"] not in SORT_FIELDS:
            raise ScreenError(f"sort must be one of: {', '.join(SORT_FIELDS)}")
        sq.sort = p["sort"]
    if "order" in p:
        if p["order"] not in ("asc", "desc"):
            raise ScreenError("order must be 'asc' or 'desc'")
        sq.order = p["order"]
    if "limit" in p:
        sq.limit = _int("limit", p["limit"], 1, MAX_LIMIT)
    if "offset" in p:
        sq.offset = _int("offset", p["offset"], 0, MAX_OFFSET)
    return sq


def _conditions(sq: ScreenQuery) -> List[Any]:
    T = ScreenerSnapshot
    conds: List[Any] = []
    for key, (lo, hi) in sq.ranges.items():
        f = RANGE_BY_KEY[key]
        col = getattr(T, f.column)
        # NULL never matches a range: a stock with unknown P/E is not "P/E under 15"
        if lo is not None:
            conds.append(col >= lo * f.scale)
        if hi is not None:
            conds.append(col <= hi * f.scale)
    if sq.sectors:
        conds.append(T.sector.in_(sq.sectors))
    for key, direction in sq.sma.items():
        col = getattr(T, SMA_FILTERS[key])
        conds.append(col > 0 if direction == "above" else col < 0)
    if sq.q:
        needle = sq.q.lower()
        conds.append(or_(func.lower(T.symbol).like(f"{needle}%"), func.lower(T.name).like(f"%{needle}%")))
    if not sq.include_etfs:
        conds.append(or_(T.asset_type.is_(None), func.lower(T.asset_type) != "etf"))
    return conds


def run_screen(db: Session, sq: ScreenQuery) -> Tuple[int, List[ScreenerSnapshot]]:
    T = ScreenerSnapshot
    conds = _conditions(sq)
    where = and_(*conds) if conds else text("1=1")
    total = db.query(func.count(T.id)).filter(where).scalar() or 0
    col = getattr(T, SORT_FIELDS[sq.sort])
    nulls_last = case((col.is_(None), 1), else_=0)
    order = col.asc() if sq.order == "asc" else col.desc()
    rows = (db.query(T).filter(where).order_by(nulls_last, order, T.symbol.asc())
            .offset(sq.offset).limit(sq.limit).all())
    return int(total), rows


def sector_counts(db: Session) -> List[Dict[str, Any]]:
    T = ScreenerSnapshot
    rows = (db.query(T.sector, func.count(T.id)).filter(T.sector.isnot(None))
            .group_by(T.sector).order_by(func.count(T.id).desc(), T.sector).all())
    return [{"name": s, "count": int(n)} for s, n in rows]


RESULT_FIELDS = ("symbol", "name", "sector", "industry", "exchange", "asset_type", "price", "change_1d_pct",
                 "change_1m_pct", "market_cap", "pe_ratio", "ps_ratio", "dividend_yield_pct",
                 "revenue_growth_yoy_pct", "profit_margin_pct", "roe_pct", "debt_to_equity", "rsi_14",
                 "sma_50", "sma_200", "price_vs_sma50_pct", "price_vs_sma200_pct")


def row_to_dict(r: ScreenerSnapshot) -> Dict[str, Any]:
    d = {k: getattr(r, k) for k in RESULT_FIELDS}
    d["flags"] = [x for x in (r.flags or "").split(",") if x]
    d["price_as_of"] = r.price_as_of.isoformat() if r.price_as_of else None
    return d


def meta() -> Dict[str, Any]:
    return {
        "filters": [{"key": f.key, "column": f.column, "label": f.label, "unit": f.unit, "min": f.lo, "max": f.hi}
                    for f in RANGE_FILTERS],
        "sma_filters": list(SMA_FILTERS),
        "sort_fields": list(SORT_FIELDS),
        "presets": [{"id": p.id, "label": p.label, "description": p.description, "params": p.params}
                    for p in PRESETS],
        "max_limit": MAX_LIMIT,
        "units": {"market_cap": "USD (filter params mcap_min/mcap_max are in billions)",
                  "percent": "percentage points (12.5 == 12.5%)", "debt_to_equity": "ratio"},
        "outlier_bounds": {k: {"min": lo, "max": hi, "flag": fl} for k, (lo, hi, fl) in BOUNDS.items()},
    }

