"""Data adapters behind the ticker context pack and the copilot tools.

``LiveSources`` wraps the existing services (quote cache, fundamentals table,
SEC financial_statements, forecast engine cache, technical-analysis service,
news_items, FRED, market snapshot, filing index).  The eval harness swaps in a
fixture implementation with the same async interface, so everything above
this layer runs identically offline.

All values are typed floats; every returned fact has id/source/as_of.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence

from app.services.copilot.models import (
    FilingChunkFact, ForecastFact, ForecastHorizon, FundamentalsFact, MacroFact, MoversFact,
    NewsFact, QuoteFact, StatementPeriod, TechnicalsFact,
)

logger = logging.getLogger(__name__)

# Instruction-like text inside retrieved data (indirect prompt injection).
INJECTION_RE = re.compile(
    r"(ignore (all |any )?(previous|prior|above) (instructions|rules)|disregard (all |any )?(prior|previous)"
    r"|^\s*system\s*:|\bsystem prompt\b|you are now|new instructions|act as (an?|the) "
    r"|recommend (buying|selling) immediately|<\s*/?\s*(context|system|instructions?)\s*>)",
    re.I | re.M,
)


def looks_injected(*texts: Optional[str]) -> bool:
    return any(t and INJECTION_RE.search(t) for t in texts)


def fnum(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _pct(num: Optional[float], den: Optional[float]) -> Optional[float]:
    if num is None or not den:
        return None
    return round(num / den * 100, 2)


def _iso(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.replace(microsecond=0).isoformat()
    return str(v)


# ── financial statements helpers (shared with the fixture sources) ───────────

FLOW_FIELDS = ("revenue", "gross_profit", "operating_income", "net_income", "eps_diluted",
               "operating_cash_flow", "capital_expenditures", "free_cash_flow")
# Filers that report share counts in another class's units (Berkshire reports
# Class A equivalents; 1 Class A = 1,500 Class B).
SHARE_CLASS_RATIO = {"BRK.B": (1500, "Berkshire reports shares as Class A equivalents; 1 Class A = 1,500 Class B")}

STOCK_FIELDS = ("total_assets", "total_liabilities", "long_term_debt", "cash_and_equivalents",
                "stockholders_equity", "shares_diluted")


def _parse_json_val(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return fnum(raw)
    try:
        return fnum(json.loads(raw).get("value"))
    except Exception:
        return fnum(raw)


def statement_periods(ticker: str, rows: Sequence[Dict[str, Any]], n_quarters: int = 8,
                      n_annual: int = 3) -> List[StatementPeriod]:
    """rows: dicts with period/form/fiscal_year/fiscal_quarter/period_end_date/filed_date and
    raw XBRL fields.  Returns latest-first: quarters (incl. a derived fiscal Q4 =
    FY - Q1..Q3 for flow items) then annuals.  Labels use SEC fiscal periods."""
    def mk(r: Dict[str, Any], *, period: str, fq: Optional[int], derived: Optional[str] = None,
           vals: Optional[Dict[str, Optional[float]]] = None) -> StatementPeriod:
        v = vals if vals is not None else {k: _parse_json_val(r.get(k)) for k in FLOW_FIELDS + STOCK_FIELDS}
        if v.get("free_cash_flow") is None and v.get("operating_cash_flow") is not None and v.get("capital_expenditures") is not None:
            v["free_cash_flow"] = v["operating_cash_flow"] - abs(v["capital_expenditures"])
        fy = r.get("fiscal_year")
        label = f"Q{fq} FY{fy}" if fq else f"FY{fy}"
        sp = StatementPeriod(
            id=f"fs:{ticker}:{period}", source=f"SEC EDGAR XBRL ({r.get('form') or '10-K/10-Q'})",
            as_of=r.get("period_end_date"), ticker=ticker, period=period, period_label=label,
            form=r.get("form"), fiscal_year=fy, fiscal_quarter=fq, period_end=r.get("period_end_date"),
            filed=r.get("filed_date"), derived=derived, **v)
        sp.gross_margin_pct = _pct(sp.gross_profit, sp.revenue)
        sp.operating_margin_pct = _pct(sp.operating_income, sp.revenue)
        sp.net_margin_pct = _pct(sp.net_income, sp.revenue)
        if sp.stockholders_equity and sp.shares_diluted:
            sp.book_value_per_share = round(sp.stockholders_equity / sp.shares_diluted, 2)
            ratio = SHARE_CLASS_RATIO.get(ticker)
            if ratio:
                sp.book_value_per_share_class = round(sp.book_value_per_share / ratio[0], 2)
                sp.share_class_note = ratio[1]
        return sp

    quarters: Dict[tuple, StatementPeriod] = {}
    annual: Dict[int, StatementPeriod] = {}
    raw_q: Dict[tuple, Dict[str, Any]] = {}
    for r in rows:
        fy, fq = r.get("fiscal_year"), r.get("fiscal_quarter")
        if fy is None:
            continue
        if fq:
            quarters[(fy, fq)] = mk(r, period=f"{fy}-Q{fq}", fq=fq)
            raw_q[(fy, fq)] = r
        elif (r.get("form") or "").startswith("10-K") or str(r.get("period", "")).endswith("FY"):
            annual[fy] = mk(r, period=f"{fy}-FY", fq=None)
    # Derived fiscal Q4 (10-K only reports the full year).
    for fy, a in annual.items():
        if (fy, 4) in quarters or not all((fy, q) in quarters for q in (1, 2, 3)):
            continue
        vals: Dict[str, Optional[float]] = {}
        for k in FLOW_FIELDS:
            if k == "eps_diluted":
                vals[k] = None
                continue
            fyv = getattr(a, k)
            parts = [getattr(quarters[(fy, q)], k) for q in (1, 2, 3)]
            vals[k] = None if fyv is None or any(p is None for p in parts) else fyv - sum(parts)
        for k in STOCK_FIELDS:
            vals[k] = getattr(a, k)
        base = {"fiscal_year": fy, "form": a.form, "period_end_date": a.period_end,
                "filed_date": a.filed}
        quarters[(fy, 4)] = mk(base, period=f"{fy}-Q4", fq=4,
                               derived="fiscal Q4 = FY (10-K) minus Q1..Q3 (10-Q)", vals=vals)
    q_sorted = [quarters[k] for k in sorted(quarters, reverse=True)]
    by_key = {(q.fiscal_year, q.fiscal_quarter): q for q in q_sorted}
    for q in q_sorted:
        prev = by_key.get((q.fiscal_year - 1, q.fiscal_quarter)) if q.fiscal_year else None
        if prev and prev.revenue and q.revenue is not None:
            q.revenue_yoy_pct = round((q.revenue / prev.revenue - 1) * 100, 2)
    a_sorted = [annual[k] for k in sorted(annual, reverse=True)]
    for i, a in enumerate(a_sorted[:-1]):
        nxt = a_sorted[i + 1]
        if nxt.revenue and a.revenue is not None:
            a.revenue_yoy_pct = round((a.revenue / nxt.revenue - 1) * 100, 2)
    return q_sorted[:n_quarters] + a_sorted[:n_annual]


def forecast_fact(ticker: str, raw: Dict[str, Any]) -> Optional[ForecastFact]:
    if not raw or not raw.get("horizons"):
        return None
    hs = []
    for h in raw["horizons"]:
        band = (h.get("bands") or {}).get("80") or [None, None]
        hs.append(ForecastHorizon(h=int(h["h"]), date=h.get("date"), p10=fnum(band[0]),
                                  p50=fnum(h.get("point")), p90=fnum(band[1]),
                                  exp_return_pct=fnum(h.get("exp_return_pct")),
                                  prob_up_pct=round(fnum(h.get("prob_up")) * 100, 1) if fnum(h.get("prob_up")) is not None else None))
    bt = raw.get("backtest") or {}
    return ForecastFact(
        id=f"fc:{ticker}", source="QuantTrade forecast engine (/api/v1/forecast)",
        as_of=raw.get("as_of"), ticker=ticker, generated_at=raw.get("generated_at"),
        last_close=fnum(raw.get("last_close")), horizons=hs,
        vol_annualized_pct=fnum(raw.get("vol_annualized_pct")),
        backtest_mase_vs_naive=bt.get("mase_vs_naive") or {},
        backtest_directional_accuracy=bt.get("directional_accuracy") or {},
    )


def news_fact(row: Dict[str, Any]) -> NewsFact:
    ai = row.get("ai") or {}
    if isinstance(ai, str):
        try:
            ai = json.loads(ai)
        except Exception:
            ai = {"note": ai}
    note = ai.get("note") or ai.get("summary") or ai.get("why_it_matters") if isinstance(ai, dict) else None
    title, summary = row.get("title") or "", row.get("summary")
    return NewsFact(
        id=f"news:{row['id']}", source=f"news_items ({row.get('source_feed') or 'feed'})",
        as_of=_iso(row.get("published_at")), ticker=(row.get("tickers") or [None])[0],
        title=title[:300], summary=(summary or "")[:600] or None, publisher=row.get("source"),
        url=row.get("url"), published_at=_iso(row.get("published_at")),
        tickers=list(row.get("tickers") or []), category=row.get("primary_category"),
        sentiment_label=row.get("sentiment_label"), sentiment_score=fnum(row.get("sentiment_score")),
        impact=row.get("impact"), ai_note=(note or None) if isinstance(note, str) else None,
        suspicious=looks_injected(title, summary, note if isinstance(note, str) else None),
    )


FRED_SERIES = {
    "FED_RATE": ("FEDFUNDS", "Effective federal funds rate", "%"),
    "10Y_YIELD": ("DGS10", "10-year Treasury yield", "%"),
    "CPI": ("CPIAUCSL", "CPI (all urban consumers, index)", "index"),
    "CPI_YOY": ("CPIAUCSL", "CPI inflation, year over year", "%"),
    "UNEMPLOYMENT": ("UNRATE", "Unemployment rate", "%"),
    "GDP_GROWTH": ("A191RL1Q225SBEA", "Real GDP growth (annualised q/q)", "%"),
    "VIX": ("VIXCLS", "CBOE VIX", "index"),
}


class LiveSources:
    """Production adapters.  Each method returns facts or None/[]; they may raise —
    the pack builder isolates failures and timeouts per source."""

    # quote ────────────────────────────────────────────────────────────────
    async def quote(self, ticker: str) -> Optional[QuoteFact]:
        """Cached quote; during the regular session a quote whose own trade
        time is older than QUOTE_MAX_AGE_S is re-fetched from the providers
        once (bypassing the cache) before it is shown."""
        from app.db.database import SessionLocal
        from app.services.quote_cache import QuoteCacheService

        async def fetch(force: bool) -> Optional[Dict[str, Any]]:
            db = SessionLocal()
            try:
                return await QuoteCacheService(db).get_quote(ticker, force_refresh=force)
            finally:
                db.close()

        fact = quote_fact(ticker, await fetch(False))
        if fact is not None and fact.stale and (fact.market_now or "") == "regular":
            fresh = quote_fact(ticker, await fetch(True))
            if fresh is not None and (fresh.quote_time or "") >= (fact.quote_time or ""):
                fact = fresh
        return fact

    # on-demand sync (what the research page does on view) ────────────────
    async def sync(self, kind: str, ticker: str, budget: Optional[float] = None) -> str:
        """Bounded fundamentals / SEC statements sync in a worker thread with
        its own DB session (app.services.copilot.data_sync)."""
        from app.services.copilot import data_sync
        return await data_sync.ensure(kind, ticker, budget)

    # fundamentals ─────────────────────────────────────────────────────────
    async def fundamentals(self, ticker: str) -> Optional[FundamentalsFact]:
        def load():
            from app.db.database import SessionLocal
            from app.models.fundamentals import Fundamentals
            from app.models.symbol import Symbol
            db = SessionLocal()
            try:
                row = (db.query(Fundamentals).join(Symbol, Symbol.id == Fundamentals.symbol_id)
                       .filter(Symbol.symbol == ticker).first())
                if row is None:
                    return None
                return {c.name: getattr(row, c.name) for c in Fundamentals.__table__.columns}
            finally:
                db.close()

        r = await asyncio.to_thread(load)
        if not r:
            return None
        f = fundamentals_fact(ticker, r)
        meta = {"id", "kind", "source", "as_of", "ticker"}
        return f if any(v is not None for k, v in f.model_dump().items() if k not in meta) else None

    # statements ───────────────────────────────────────────────────────────
    async def statements(self, ticker: str) -> List[StatementPeriod]:
        def load():
            from app.db.database import SessionLocal
            from app.models.edgar import FinancialStatement
            from app.models.symbol import Symbol
            db = SessionLocal()
            try:
                rows = (db.query(FinancialStatement).join(Symbol, Symbol.id == FinancialStatement.symbol_id)
                        .filter(Symbol.symbol == ticker)
                        .order_by(FinancialStatement.period_end_date.desc()).limit(24).all())
                return [{c.name: getattr(r, c.name) for c in FinancialStatement.__table__.columns} for r in rows]
            finally:
                db.close()

        return statement_periods(ticker, await asyncio.to_thread(load))

    # forecast (cache only; a cold fit is kicked off in the background) ────
    async def forecast(self, ticker: str) -> Optional[ForecastFact]:
        from app.api import forecast as fc_api
        from app.services.redis_cache_service import cache_service
        raw = await cache_service.get(f"forecast:{fc_api._CACHE_VERSION}:{ticker}")
        if not raw:
            task = asyncio.create_task(fc_api._get_or_compute(ticker))
            task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
            return None
        return forecast_fact(ticker, raw)

    # technicals ───────────────────────────────────────────────────────────
    async def technicals(self, ticker: str) -> Optional[TechnicalsFact]:
        from app.services.technical_analysis_service import ta_service
        sig = await ta_service.compute_signals(ticker)
        if sig is None:
            return None
        d = sig.to_dict() if hasattr(sig, "to_dict") else dict(sig)
        return TechnicalsFact(
            id=f"ta:{ticker}", source=f"technical analysis service ({d.get('source') or 'OHLCV'})",
            as_of=datetime.now(timezone.utc).date().isoformat(), ticker=ticker,
            **{k: d.get(k) for k in ("price", "rsi_14", "macd", "macd_signal", "sma_20", "sma_50",
                                     "sma_200", "atr_14", "high_52w", "low_52w", "trend", "momentum",
                                     "volatility", "signal_strength")})

    # news ─────────────────────────────────────────────────────────────────
    async def news(self, ticker: str, days: int = 7, limit: int = 8) -> List[NewsFact]:
        def load():
            from sqlalchemy import text
            from app.db.database import SessionLocal
            db = SessionLocal()
            try:
                since = datetime.now(timezone.utc) - timedelta(days=days)
                rows = db.execute(text(
                    "SELECT id, title, summary, url, source, source_feed, published_at, tickers, "
                    "primary_category, sentiment_label, sentiment_score, impact, ai FROM news_items "
                    "WHERE tickers @> ARRAY[:t]::varchar[] AND published_at >= :since "
                    "ORDER BY impact DESC NULLS LAST, published_at DESC LIMIT :n"),
                    {"t": ticker, "since": since, "n": limit}).mappings().all()
                return [dict(r) for r in rows]
            finally:
                db.close()

        return [news_fact(r) for r in await asyncio.to_thread(load)]

    # filings ──────────────────────────────────────────────────────────────
    async def filings(self, ticker: str, query: str, *, filing_types: Optional[List[str]] = None,
                      section: Optional[str] = None, limit: int = 4) -> List[FilingChunkFact]:
        from app.services.copilot.retrieval import search_filings
        return await search_filings(query, [ticker], filing_types=filing_types, section=section, limit=limit)

    # macro ────────────────────────────────────────────────────────────────
    async def macro(self, indicators: List[str]) -> List[MacroFact]:
        import httpx
        from app.config import settings
        key = getattr(settings, "FRED_API_KEY", None)
        if not key:
            return []
        out: List[MacroFact] = []
        async with httpx.AsyncClient(timeout=6.0) as client:
            for ind in indicators:
                spec = FRED_SERIES.get(ind.upper())
                if not spec:
                    continue
                series, name, unit = spec
                yoy = ind.upper() == "CPI_YOY"
                r = await client.get("https://api.stlouisfed.org/fred/series/observations", params={
                    "series_id": series, "api_key": key, "file_type": "json", "sort_order": "desc",
                    "limit": 13 if yoy else 1})
                r.raise_for_status()
                obs = [o for o in r.json().get("observations", []) if o.get("value") not in (".", None)]
                if not obs:
                    continue
                val = fnum(obs[0]["value"])
                if yoy:
                    if len(obs) < 13 or not fnum(obs[12]["value"]):
                        continue
                    val = round((val / fnum(obs[12]["value"]) - 1) * 100, 2)
                out.append(MacroFact(id=f"macro:{ind.upper()}", source=f"FRED {series}",
                                     as_of=obs[0]["date"], series=series, name=name, value=val,
                                     unit=unit, observation_date=obs[0]["date"]))
        return out

    # market movers ────────────────────────────────────────────────────────
    async def movers(self, direction: str, sector: Optional[str] = None,
                     min_market_cap: Optional[float] = None, limit: int = 10) -> Optional[MoversFact]:
        from app.api.market import get_top_gainers, get_top_losers
        fn = get_top_losers if direction == "losers" else get_top_gainers
        rows = await fn(50, False, None)
        out = []
        for r in rows:
            d = r.model_dump() if hasattr(r, "model_dump") else dict(r)
            if sector and sector.lower() not in (d.get("sector") or "").lower():
                continue
            if min_market_cap and (d.get("market_cap") or 0) < min_market_cap:
                continue
            out.append(d)
        return MoversFact(id=f"movers:{direction}", source="market snapshot (/api/v1/market)",
                          as_of=_iso(datetime.now(timezone.utc)), direction=direction, rows=out[:limit])


# A regular-session quote older than this is re-fetched, and flagged stale if
# no provider has anything newer.
QUOTE_MAX_AGE_S = int(os.getenv("COPILOT_QUOTE_MAX_AGE_S", "900"))


def _utcnow() -> datetime:          # patched in tests
    return datetime.now(timezone.utc)


def _parse_ts(v: Any) -> Optional[datetime]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(float(v), tz=timezone.utc)
    if isinstance(v, datetime):
        dt = v
    else:
        try:
            dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def quote_fact(ticker: str, q: Optional[Dict[str, Any]], now: Optional[datetime] = None) -> Optional[QuoteFact]:
    """QuoteFact from a QuoteCacheService payload, labelled by the quote's OWN
    trade time against the exchange calendar (never by the wall clock).

    ``market_time`` is the provider's last-trade time; ``timestamp`` is when
    we fetched it for most providers, so it is only a fallback for as_of and
    never used to claim a quote is current."""
    from app.services import market_calendar as mc
    from app.services.canonical_quote import QUOTE_VERSION
    if not q or q.get("unavailable") or fnum(q.get("price")) is None:
        return None
    now = now or _utcnow()
    if q.get("quote_version") == QUOTE_VERSION and q.get("regular"):
        return _canonical_quote_fact(ticker, q, now)
    state = mc.market_state(now)
    market_now = mc.label(state.session, state.holiday)
    traded = _parse_ts(q.get("market_time"))
    fetched = _parse_ts(q.get("timestamp") or q.get("updated_at") or q.get("last_updated"))
    if traded is not None and traded > now:
        traded = now
    session = None
    age_min = None
    stale = None
    if traded is not None:
        ts_et = traded.astimezone(mc.ET)
        session = mc.label(mc.session_at(traded), mc.holiday_name(ts_et.date()))
        age_s = max(0.0, (now - traded).total_seconds())
        age_min = round(age_s / 60, 1)
        if state.is_open:
            stale = age_s > QUOTE_MAX_AGE_S
        else:
            # outside the session the last print is current unless it predates
            # the most recent completed regular session
            last_day = state.now_et.date()
            if not (mc.is_trading_day(last_day) and state.now_et.time() >= mc.OPEN):
                last_day = mc.previous_trading_day(last_day)
            stale = traded < datetime.combine(last_day, mc.OPEN, tzinfo=mc.ET)
        when = ts_et.strftime("%Y-%m-%d %H:%M ET")
        age_txt = f"{age_min:.0f} min" if age_min < 120 else f"{age_min / 60:.1f} h"
        note = f"last trade {when} ({session}), {age_txt} old; US market now: {market_now}"
        if stale:
            note += "; STALE - do not present as a live price"
        elif not state.is_open:
            note += "; latest available price, not live"
    else:
        note = f"provider gave no trade time; fetched {fetched.isoformat() if fetched else 'at an unknown time'}"
        note += f"; US market now: {market_now}"
    return QuoteFact(
        id=f"quote:{ticker}", source=f"quote cache ({q.get('data_source') or 'market data'})",
        as_of=(traded or fetched).replace(microsecond=0).isoformat() if (traded or fetched) else None,
        ticker=ticker, price=fnum(q.get("price")), change=fnum(q.get("change")),
        change_percent=fnum(q.get("change_percent")), volume=fnum(q.get("volume")),
        previous_close=fnum(q.get("previous_close") or q.get("prev_close")),
        day_high=fnum(q.get("high")), day_low=fnum(q.get("low")),
        market_session=session, market_now=market_now,
        quote_time=traded.replace(microsecond=0).isoformat() if traded else None,
        age_minutes=age_min, stale=stale, freshness_note=note)


def _canonical_quote_fact(ticker: str, q: Dict[str, Any], now: datetime) -> QuoteFact:
    """QuoteFact from a canonical quote: the headline is the regular-session
    price (the same number every other tab shows); any pre-market /
    after-hours / overnight print is carried separately in extended_*.

    Incident 2026-11-26 21:45 ET (Thanksgiving): the copilot quoted AMD
    423.01 (+2.36%), an overnight print, while every other tab showed the
    Nov 25 close 406.03 (-1.75%)."""
    from app.services import market_calendar as mc
    from app.services.canonical_quote import extended_label
    reg = q["regular"]
    ext = q.get("extended") or None
    state = mc.market_state(now)
    market_now = mc.label(state.session, state.holiday)
    as_of = _parse_ts(q.get("as_of"))
    if as_of is not None and as_of > now:
        as_of = now
    age_min = round(max(0.0, (now - as_of).total_seconds()) / 60, 1) if as_of else None
    live = bool(reg.get("live")) and state.is_open
    if live:
        stale = (age_min * 60 > QUOTE_MAX_AGE_S) if age_min is not None else None
    else:
        stale = bool(q.get("stale"))
    prev = fnum(reg.get("previous_close"))
    prev_txt = (f"change vs the {reg.get('previous_session_date')} close {prev:.2f}" if prev
                else "previous close not available")
    if live:
        when = as_of.astimezone(mc.ET).strftime("%H:%M ET") if as_of else "unknown time"
        note = f"live regular-session price, last trade {when}"
        if age_min is not None:
            note += f" ({age_min:.0f} min old)"
    else:
        note = f"regular-session close of {reg.get('session_date')}; latest regular price, not live"
    note += f"; {prev_txt}; US market now: {market_now}"
    if stale:
        note += "; STALE - do not present as a live price"
    if ext:
        et = _parse_ts(ext.get("time"))
        lbl = extended_label(ext)
        note += (f"; extended-hours trade (separate from the price above): {lbl} vs the regular close"
                 + (f", at {et.astimezone(mc.ET).strftime('%Y-%m-%d %H:%M ET')}" if et else "")
                 + " - mention it separately and label it, never as the price")
    return QuoteFact(
        id=f"quote:{ticker}", source=f"quote cache ({q.get('source') or q.get('data_source') or 'market data'})",
        as_of=as_of.replace(microsecond=0).isoformat() if as_of else None,
        ticker=ticker, price=fnum(reg.get("price")), change=fnum(reg.get("change")),
        change_percent=fnum(reg.get("change_percent")), volume=fnum(q.get("volume")),
        previous_close=prev, day_high=fnum(q.get("high")), day_low=fnum(q.get("low")),
        market_session=mc.REGULAR, market_now=market_now,
        quote_time=as_of.replace(microsecond=0).isoformat() if as_of else None,
        age_minutes=age_min, stale=stale, freshness_note=note,
        session_date=reg.get("session_date"), previous_close_date=reg.get("previous_session_date"),
        extended_price=fnum(ext.get("price")) if ext else None,
        extended_change_percent=fnum(ext.get("change_percent")) if ext else None,
        extended_session=ext.get("session") if ext else None,
        extended_time=ext.get("time") if ext else None)


def fundamentals_fact(ticker: str, r: Dict[str, Any]) -> FundamentalsFact:
    from app.services.fundamental_units import normalize_fundamental_units
    r = normalize_fundamental_units(r)      # percentage points + D/E ratio, whichever fetcher wrote it

    def pct(k: str) -> Optional[float]:
        v = fnum(r.get(k))
        return None if v is None else round(v, 2)

    return FundamentalsFact(
        id=f"fund:{ticker}", source="fundamentals table (finviz / yfinance / FMP)",
        as_of=_iso(r.get("fetched_at") or r.get("updated_at") or r.get("created_at")), ticker=ticker,
        company_name=r.get("company_name"), sector=r.get("sector"), industry=r.get("industry"),
        market_cap=fnum(r.get("market_cap")), pe_ratio=fnum(r.get("pe_ratio")),
        forward_pe=fnum(r.get("forward_pe")), peg_ratio=fnum(r.get("peg_ratio")),
        price_to_sales=fnum(r.get("price_to_sales")), price_to_book=fnum(r.get("price_to_book")),
        ev_to_ebitda=fnum(r.get("ev_to_ebitda")), eps_ttm=fnum(r.get("eps")),
        revenue_ttm=fnum(r.get("revenue")), profit_margin_pct=pct("profit_margin"),
        operating_margin_pct=pct("operating_margin"), gross_margin_pct=pct("gross_margin"),
        roe_pct=pct("roe"), debt_to_equity=fnum(r.get("debt_to_equity")),
        current_ratio=fnum(r.get("current_ratio")), dividend_yield_pct=pct("dividend_yield"),
        beta=fnum(r.get("beta")), week_52_high=fnum(r.get("week_52_high")),
        week_52_low=fnum(r.get("week_52_low")), target_price=fnum(r.get("target_price")),
        recommendation=_recommendation(r.get("recommendation")), earnings_date=r.get("earnings_date"))


def _recommendation(v: Any) -> Optional[str]:
    """finviz stores the consensus as a number (1 = strong buy ... 5 = sell)."""
    if v is None or v == "":
        return None
    f = fnum(v)
    return f"{f:g} on a 1 (strong buy) to 5 (sell) scale" if f is not None else str(v)
