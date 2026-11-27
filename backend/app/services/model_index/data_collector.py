"""
Model Index Engine — Data Collector

Aggregates data from all existing services (QuoteCacheService, FinvizFetcher,
FMP, IndicatorService, RiskScorer, DB models) into a unified StockData dict
for downstream scoring engines.

Data order: DB first (symbols, fundamentals, price_bars), then one batched
quote call, then a time-boxed external fundamentals fallback (yfinance) for
stocks the DB has no fundamentals row for.
"""

import collections
import logging
import asyncio
import numpy as np
from typing import Dict, List, Optional, Any
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.symbol import Symbol
from app.models.fundamentals import Fundamentals
from app.models.price import PriceBar
from app.services.quote_cache import QuoteCacheService
from app.services.indicators import IndicatorService
from app.services.risk_scorer import RiskScorer
from app.services.finviz_fetcher import FinvizFetcher
from app.services.model_index.config import (
    get_full_universe,
    get_sector_for_ticker,
    DATA_QUALITY,
)

logger = logging.getLogger(__name__)

# ── Sector name normalization ────────────────────────────────────────────────
_SECTOR_MAP = {
    "financial services": "Financials",
    "financials": "Financials",
    "technology": "Technology",
    "healthcare": "Healthcare",
    "consumer cyclical": "Consumer Cyclical",
    "consumer defensive": "Consumer Defensive",
    "communication services": "Communication Services",
    "industrials": "Industrials",
    "energy": "Energy",
    "utilities": "Utilities",
    "real estate": "Real Estate",
    "basic materials": "Materials",
    "materials": "Materials",
    "biotechnology": "Biotechnology",
    "semiconductors": "Semiconductors",
    "aerospace & defense": "Aerospace & Defense",
    "transportation": "Transportation",
}

def _normalize_sector(sector: str) -> str:
    """Normalize sector names to consistent title case."""
    if not sector:
        return "Unknown"
    return _SECTOR_MAP.get(sector.lower().strip(), sector.title())


def _sf(val, default=None):
    """Safe float conversion — handles None, NaN, Inf."""
    if val is None:
        return default
    try:
        v = float(val)
        if np.isnan(v) or np.isinf(v):
            return default
        return v
    except (TypeError, ValueError):
        return default


def _sp(val, default=None):
    """Safe percent string to float (e.g. '12.5%' -> 12.5)."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return _sf(val, default)
    try:
        return float(str(val).replace("%", "").replace(",", "").strip())
    except (TypeError, ValueError):
        return default


# ── StockData fields for completeness tracking ──────────────────────────────

CORE_FIELDS = [
    "price", "market_cap", "sector", "pe_ratio", "forward_pe",
    "profit_margin", "operating_margin", "roe", "roa", "debt_to_equity",
    "eps", "revenue", "beta", "rsi", "sma_50", "sma_200",
    "volatility", "max_drawdown", "target_price", "recommendation",
]

FUNDAMENTAL_NUMERIC_FIELDS = (
    "pe_ratio", "forward_pe", "peg_ratio", "price_to_sales", "price_to_book", "ev_to_ebitda",
    "dividend_yield", "profit_margin", "operating_margin", "gross_margin", "roa", "roe", "roi",
    "roic", "debt_to_equity", "current_ratio", "quick_ratio", "eps", "eps_next_quarter",
    "eps_next_year", "revenue", "quarterly_revenue_growth", "quarterly_earnings_growth", "beta",
    "short_float", "insider_ownership", "institutional_ownership", "target_price",
    "analyst_rating", "shares_outstanding", "avg_volume",
)

# Quote + external-fallback budgets. The UI refreshes synchronously with a 90 s
# client timeout (Cloudflare cuts at ~100 s), so collection must finish well
# inside that.
QUOTE_BUDGET_S = 30.0
FALLBACK_BUDGET_S = 25.0
FALLBACK_PER_CALL_S = 8.0
FALLBACK_CONCURRENCY = 8
FALLBACK_CACHE_PREFIX = "mi:fund_fallback:v1:"
FALLBACK_CACHE_TTL_S = 12 * 3600


def summarize_collection(results: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Coverage summary: how many stocks are scoreable and why the rest are not."""
    reasons: collections.Counter = collections.Counter()
    for d in results.values():
        r = d.get("_failure_reason")
        if r:
            # Group by the detail in parentheses so similar stocks collapse.
            key = r.split("(", 1)[-1].rstrip(")") if "(" in r else r
            reasons[key[:120]] += 1
    failed = sum(1 for d in results.values() if d.get("_failure_reason"))
    comps = [d.get("data_completeness", 0) for d in results.values()]
    return {
        "universe_size": len(results),
        "scoreable": len(results) - failed,
        "failed": failed,
        "avg_completeness": round(float(np.mean(comps)), 1) if comps else 0.0,
        "top_reasons": [{"reason": k, "count": v} for k, v in reasons.most_common(5)],
        "failures": {t: d["_failure_reason"] for t, d in results.items() if d.get("_failure_reason")},
    }


class DataCollector:
    """
    Collects and normalizes data from multiple sources into a unified
    StockData dictionary per ticker.
    """

    def __init__(self, db: Session):
        self.db = db
        self.quote_service = QuoteCacheService(db)
        self._fallback_errors: Dict[str, str] = {}
        self.last_diagnostics: Dict[str, Any] = {}

    # ── DB reads (sync; the Session is only used by one statement at a time) ──

    def _safe_rollback(self) -> None:
        """Reset the session after a failed statement so the next stock can query."""
        try:
            self.db.rollback()
        except Exception:
            pass

    def _get_symbol_record(self, ticker: str) -> Optional[Symbol]:
        """Look up Symbol model from DB."""
        return self.db.query(Symbol).filter(Symbol.symbol == ticker.upper()).first()

    def _get_fundamentals(self, symbol_id: int) -> Optional[Fundamentals]:
        """Get cached fundamentals from DB."""
        return self.db.query(Fundamentals).filter(
            Fundamentals.symbol_id == symbol_id
        ).first()

    def _get_indicators(self, symbol_id: int) -> Dict:
        """Compute technical indicators from price history."""
        try:
            return IndicatorService.get_all_indicators(self.db, symbol_id)
        except Exception as e:
            logger.debug(f"Indicators failed for symbol_id={symbol_id}: {e}")
            self._safe_rollback()
            return {}

    def _get_risk(self, symbol_id: int) -> Dict:
        """Compute risk metrics."""
        try:
            return RiskScorer.calculate_risk_score(self.db, symbol_id)
        except Exception as e:
            logger.debug(f"Risk scoring failed for symbol_id={symbol_id}: {e}")
            self._safe_rollback()
            return {}

    def _get_price_history(self, symbol_id: int, days: int = 252) -> List[float]:
        """Get closing price series for calculations."""
        bars = (
            self.db.query(PriceBar)
            .filter(PriceBar.symbol_id == symbol_id)
            .order_by(PriceBar.timestamp.desc())
            .limit(days)
            .all()
        )
        return [_sf(b.close) for b in reversed(bars) if _sf(b.close) is not None]

    def _preload(self, tickers: List[str]) -> Dict[str, Any]:
        """Bulk-read what the DB already has for the universe: one query each for
        symbols, fundamentals and per-symbol price_bar counts."""
        wanted = sorted({t.upper() for t in tickers} | {"SPY"})
        syms = self.db.query(Symbol).filter(Symbol.symbol.in_(wanted)).all()
        by_ticker = {s.symbol.upper(): s for s in syms}
        ids = [s.id for s in syms]
        funds: Dict[int, Fundamentals] = {}
        bar_counts: Dict[int, int] = {}
        if ids:
            for f in self.db.query(Fundamentals).filter(Fundamentals.symbol_id.in_(ids)).all():
                funds[f.symbol_id] = f
            rows = (
                self.db.query(PriceBar.symbol_id, func.count(PriceBar.id))
                .filter(PriceBar.symbol_id.in_(ids))
                .group_by(PriceBar.symbol_id)
                .all()
            )
            bar_counts = {int(sid): int(n) for sid, n in rows}
        spy = by_ticker.get("SPY")
        market_prices = self._get_price_history(spy.id, 252) if spy and bar_counts.get(spy.id) else None
        # End the read-only transaction so the pooled connection is not held
        # while quote providers are awaited.
        self._safe_rollback()
        return {"symbols": by_ticker, "fundamentals": funds, "bar_counts": bar_counts,
                "market_prices": market_prices}

    def _compute_returns(self, prices: List[float]) -> List[float]:
        """Compute daily returns from price series."""
        if len(prices) < 2:
            return []
        return [(prices[i] - prices[i - 1]) / prices[i - 1]
                for i in range(1, len(prices)) if prices[i - 1] > 0]

    def _compute_beta(self, stock_prices: List[float], market_prices: List[float]) -> Optional[float]:
        """Compute beta against market (SPY)."""
        if len(stock_prices) < 30 or len(market_prices) < 30:
            return None
        min_len = min(len(stock_prices), len(market_prices))
        stock_ret = self._compute_returns(stock_prices[-min_len:])
        market_ret = self._compute_returns(market_prices[-min_len:])
        if len(stock_ret) < 20 or len(market_ret) < 20:
            return None
        min_ret = min(len(stock_ret), len(market_ret))
        s = np.array(stock_ret[-min_ret:])
        m = np.array(market_ret[-min_ret:])
        cov = np.cov(s, m)
        if cov[1][1] == 0:
            return None
        return float(cov[0][1] / cov[1][1])

    def _compute_data_completeness(self, data: Dict) -> float:
        """Calculate what percentage of core fields are populated."""
        filled = sum(1 for f in CORE_FIELDS if data.get(f) is not None)
        return round(filled / len(CORE_FIELDS) * 100, 1)

    # ── External sources (network only; never touch the Session) ──────────

    async def _safe_quotes(self, tickers: List[str]) -> Dict[str, Dict[str, Any]]:
        """One batched quote call for the whole universe. Never raises."""
        if not tickers:
            return {}
        try:
            quotes = await asyncio.wait_for(self.quote_service.get_quotes(tickers), QUOTE_BUDGET_S)
        except Exception as e:
            logger.warning("Model index: quote fetch failed for %d tickers: %s: %s",
                           len(tickers), type(e).__name__, e)
            self._safe_rollback()
            return {}
        return {k.upper(): v for k, v in (quotes or {}).items()
                if isinstance(v, dict) and not v.get("unavailable")}

    async def _fallback_fundamentals(self, tickers: List[str], budget_s: float) -> Dict[str, Dict[str, Any]]:
        """Fundamentals for tickers with no DB row: Redis cache, then yfinance,
        time-boxed. Results stay in memory/Redis; the DB is never written here."""
        out: Dict[str, Dict[str, Any]] = {}
        if not tickers or budget_s <= 0:
            return out
        try:
            from app.services.redis_cache_service import cache_service
        except Exception:  # pragma: no cover - cache is optional
            cache_service = None

        pending = []
        for t in tickers:
            cached = None
            if cache_service is not None:
                try:
                    cached = await cache_service.get(f"{FALLBACK_CACHE_PREFIX}{t}")
                except Exception:
                    cached = None
            if isinstance(cached, dict) and cached:
                out[t] = cached
            else:
                pending.append(t)
        if not pending:
            return out

        sem = asyncio.Semaphore(FALLBACK_CONCURRENCY)

        async def one(t: str):
            async with sem:
                try:
                    d = await asyncio.wait_for(
                        asyncio.to_thread(FinvizFetcher.fetch_yfinance_fundamentals, t),
                        FALLBACK_PER_CALL_S,
                    )
                except Exception as e:
                    self._fallback_errors[t] = f"{type(e).__name__}: {e}"[:160]
                    return
                if not isinstance(d, dict) or d.get("error"):
                    self._fallback_errors[t] = str((d or {}).get("error") or "empty response")[:160]
                    return
                out[t] = d
                if cache_service is not None:
                    try:
                        await cache_service.set(f"{FALLBACK_CACHE_PREFIX}{t}", d, ttl=FALLBACK_CACHE_TTL_S)
                    except Exception:
                        pass

        tasks = [asyncio.ensure_future(one(t)) for t in pending]
        _, not_done = await asyncio.wait(tasks, timeout=budget_s)
        for task in not_done:
            task.cancel()
        if not_done:
            skipped = [t for t, task in zip(pending, tasks) if task in not_done]
            for t in skipped:
                self._fallback_errors.setdefault(t, f"fallback budget {budget_s:.0f}s exhausted")
            logger.warning("Model index: fundamentals fallback budget (%.0fs) hit; %d tickers skipped",
                           budget_s, len(skipped))
        return out

    # ── Assembly ─────────────────────────────────────────────────────────────

    @staticmethod
    def _apply_fundamentals(data: Dict[str, Any], fund: Any, source: str) -> None:
        """Copy fundamentals from a DB row (attributes) or a fallback dict (keys)."""
        if isinstance(fund, dict):
            def get(k):
                return fund.get(k)
        else:
            def get(k):
                return getattr(fund, k, None)
        data["company_name"] = data.get("company_name") or get("company_name")
        if (not data.get("sector") or data.get("sector") == "Unknown") and get("sector"):
            data["sector"] = _normalize_sector(get("sector"))
        data["industry"] = data.get("industry") or get("industry")
        for k in FUNDAMENTAL_NUMERIC_FIELDS:
            v = _sf(get(k))
            if v is not None:
                data[k] = v
        rec = get("recommendation")
        if rec not in (None, ""):
            data["recommendation"] = rec
        data["earnings_date"] = data.get("earnings_date") or get("earnings_date")
        data["market_cap"] = data.get("market_cap") or _sf(get("market_cap"))
        data["price"] = data.get("price") or _sf(get("price"))
        data["week_52_high"] = data.get("week_52_high") or _sf(get("week_52_high")) or _sf(get("52w_high"))
        data["week_52_low"] = data.get("week_52_low") or _sf(get("week_52_low")) or _sf(get("52w_low"))
        data["fundamentals_source"] = source

    def _assemble_stock(
        self,
        ticker: str,
        sym: Optional[Symbol],
        quote: Optional[Dict[str, Any]],
        fund: Any,
        fund_source: Optional[str],
        bar_count: int,
        market_prices: Optional[List[float]],
    ) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "ticker": ticker,
            "company_name": None,
            "sector": get_sector_for_ticker(ticker),
            "industry": None,
            "price_bar_count": bar_count,
        }
        sources: List[str] = []
        symbol_id = None
        if sym is not None:
            data["company_name"] = sym.name
            if sym.sector:
                data["sector"] = _normalize_sector(sym.sector)
            data["industry"] = getattr(sym, "industry", None)
            symbol_id = sym.id
        data["_symbol_found"] = sym is not None

        # 1. Quote (latest price)
        if quote:
            data["price"] = _sf(quote.get("price"))
            data["change_pct"] = _sf(quote.get("change_percent"))
            data["volume"] = _sf(quote.get("volume"))
            data["market_cap"] = _sf(quote.get("market_cap"))
            sources.append("quote")

        # 2. Fundamentals: DB row first, external fallback second
        if fund is not None:
            self._apply_fundamentals(data, fund, fund_source or "db")
            sources.append(f"fundamentals:{fund_source or 'db'}")

        # 3. Technicals + risk from DB price_bars (skipped when there are none)
        if symbol_id is not None and bar_count > 0:
            indicators = self._get_indicators(symbol_id)
            if indicators:
                data["rsi"] = _sf(indicators.get("rsi"))
                data["sma_20"] = _sf(indicators.get("sma_20"))
                data["sma_50"] = _sf(indicators.get("sma_50"))
                data["sma_200"] = _sf(indicators.get("sma_200"))
                data["current_price_ind"] = _sf(indicators.get("current_price"))
                macd = indicators.get("macd", {})
                if isinstance(macd, dict):
                    data["macd_value"] = _sf(macd.get("macd"))
                    data["macd_signal"] = _sf(macd.get("signal"))
                    data["macd_histogram"] = _sf(macd.get("histogram"))
                bb = indicators.get("bollinger_bands", {})
                if isinstance(bb, dict):
                    data["bb_upper"] = _sf(bb.get("upper"))
                    data["bb_middle"] = _sf(bb.get("middle"))
                    data["bb_lower"] = _sf(bb.get("lower"))
                data["price"] = data.get("price") or data.get("current_price_ind")
                sources.append("price_bars")

            risk = self._get_risk(symbol_id)
            if risk:
                data["risk_score_raw"] = _sf(risk.get("risk_score"))
                data["risk_level"] = risk.get("risk_level")
                factors = risk.get("factors", {})
                data["volatility"] = _sf(factors.get("volatility"))
                data["max_drawdown"] = _sf(factors.get("max_drawdown"))
                # Prefer computed beta over fundamentals beta
                computed_beta = _sf(factors.get("beta"))
                if computed_beta and computed_beta != 1.0:
                    data["beta"] = computed_beta

            # Real beta + downside deviation from price history vs SPY
            if market_prices:
                stock_prices = self._get_price_history(symbol_id, 252)
                real_beta = self._compute_beta(stock_prices, market_prices)
                if real_beta is not None:
                    data["beta"] = real_beta
                neg_returns = [r for r in self._compute_returns(stock_prices) if r < 0]
                if neg_returns:
                    data["downside_deviation"] = float(np.std(neg_returns) * np.sqrt(252) * 100)

        data["data_sources"] = sources
        data["data_completeness"] = self._compute_data_completeness(data)
        return data

    @staticmethod
    def _failure_reason(data: Dict[str, Any], fallback_error: Optional[str]) -> Optional[str]:
        """Why a stock will not be scored (None = it will be)."""
        threshold = DATA_QUALITY["min_completeness_for_scoring"] * 100
        if data.get("data_completeness", 0) >= threshold:
            return None
        missing = []
        if not data.get("price"):
            missing.append("no quote/price")
        if not data.get("fundamentals_source"):
            missing.append("no fundamentals" + (f" [fallback: {fallback_error}]" if fallback_error else ""))
        if not data.get("price_bar_count"):
            missing.append("no price_bars")
        detail = ", ".join(missing) or "sparse fields"
        return f"completeness {data.get('data_completeness', 0):.0f}% < {threshold:.0f}% ({detail})"

    def _assemble_all(self, tickers, pre, quotes, fallback) -> Dict[str, Dict[str, Any]]:
        """Build every stock sequentially; one stock's error never sinks the rest."""
        results: Dict[str, Dict[str, Any]] = {}
        for t in tickers:
            sym = pre["symbols"].get(t)
            fund, src = None, None
            if sym is not None and sym.id in pre["fundamentals"]:
                fund, src = pre["fundamentals"][sym.id], "db"
            elif t in fallback:
                fund, src = fallback[t], fallback[t].get("data_source") or "external"
            try:
                data = self._assemble_stock(
                    t, sym, quotes.get(t), fund, src,
                    pre["bar_counts"].get(sym.id, 0) if sym is not None else 0,
                    pre["market_prices"],
                )
            except Exception as e:
                self._safe_rollback()
                results[t] = {
                    "ticker": t, "data_completeness": 0.0, "_symbol_found": sym is not None,
                    "_failure_reason": f"collect error: {type(e).__name__}: {e}"[:200],
                }
                continue
            reason = self._failure_reason(data, self._fallback_errors.get(t))
            if reason:
                data["_failure_reason"] = reason
            results[t] = data
        self._safe_rollback()
        return results

    async def collect_stock(self, ticker: str, market_prices: Optional[List[float]] = None) -> Dict[str, Any]:
        """
        Collect all available data for one ticker from DB and services.
        Returns a unified StockData dict. Missing data is None.
        """
        t = ticker.upper()
        data = (await self.collect_universe([t], market_prices=market_prices)).get(t)
        return data or {"ticker": t, "data_completeness": 0.0, "_symbol_found": False}

    async def collect_universe(
        self,
        tickers: Optional[List[str]] = None,
        max_concurrent: int = 10,  # kept for API compatibility; DB work is sequential
        market_prices: Optional[List[float]] = None,
        external_fallback: bool = True,
        fallback_budget_s: Optional[float] = None,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Collect data for the full universe (or a subset).

        The request Session is only used by one statement at a time. The old
        per-stock ``asyncio.gather`` shared it with the quote service's worker
        thread, and in prod every stock failed with "This session is in
        'prepared' state", so no basket could be built. Each stock that cannot
        be scored carries a ``_failure_reason``; a summary is logged and kept
        in ``self.last_diagnostics``.
        """
        if tickers is None:
            tickers = get_full_universe()
        tickers = list(dict.fromkeys(t.upper() for t in tickers))
        self._fallback_errors = {}

        pre = await asyncio.to_thread(self._preload, tickers)
        if market_prices is not None:
            pre["market_prices"] = market_prices
        quotes = await self._safe_quotes(tickers)

        no_fund = [
            t for t in tickers
            if not (pre["symbols"].get(t) is not None and pre["symbols"][t].id in pre["fundamentals"])
        ]
        fallback: Dict[str, Dict[str, Any]] = {}
        if external_fallback and no_fund:
            budget = FALLBACK_BUDGET_S if fallback_budget_s is None else fallback_budget_s
            fallback = await self._fallback_fundamentals(no_fund, budget)

        results = await asyncio.to_thread(self._assemble_all, tickers, pre, quotes, fallback)

        diag = summarize_collection(results)
        diag.update({
            "db_fundamentals": len(tickers) - len(no_fund),
            "fallback_fundamentals": len(fallback),
            "quotes": len(quotes),
            "with_price_bars": sum(1 for t in tickers
                                   if pre["symbols"].get(t) is not None
                                   and pre["bar_counts"].get(pre["symbols"][t].id)),
        })
        self.last_diagnostics = diag
        logger.info(
            "Model index data collection: %d tickers, %d scoreable, %d DB fundamentals, "
            "%d fallback fundamentals, %d quotes, %d with price_bars, avg completeness %.1f%%",
            len(results), diag["scoreable"], diag["db_fundamentals"], diag["fallback_fundamentals"],
            diag["quotes"], diag["with_price_bars"], diag["avg_completeness"],
        )
        for t, reason in diag["failures"].items():
            logger.info("Model index: %s not scoreable: %s", t, reason)
        if diag["failed"]:
            logger.warning("Model index: %d/%d stocks not scoreable; top reasons: %s",
                           diag["failed"], len(results), diag["top_reasons"])
        return results

    async def collect_macro(self) -> Dict[str, Any]:
        """
        Collect macro indicators: VIX, market breadth, yield proxies.
        """
        macro: Dict[str, Any] = {
            "vix": None,
            "spy_price": None,
            "breadth_above_sma200": None,
            "momentum_breadth": None,
            "timestamp": datetime.utcnow().isoformat(),
        }

        # One batched call (VIX, SPY, TLT as bond proxy)
        quotes = await self._safe_quotes(["^VIX", "SPY", "TLT"])
        macro["vix"] = _sf((quotes.get("^VIX") or {}).get("price"))
        macro["spy_price"] = _sf((quotes.get("SPY") or {}).get("price"))
        tlt = _sf((quotes.get("TLT") or {}).get("price"))
        if tlt is not None:
            macro["tlt_price"] = tlt

        return macro

    def compute_breadth(self, universe_data: Dict[str, Dict[str, Any]]) -> Dict[str, float]:
        """
        Compute market breadth metrics from collected universe data.
        Returns percentage of stocks above key moving averages.
        """
        total = 0
        above_sma200 = 0
        positive_macd = 0
        above_sma50 = 0

        for ticker, data in universe_data.items():
            price = data.get("price")
            sma200 = data.get("sma_200")
            sma50 = data.get("sma_50")
            macd_hist = data.get("macd_histogram")

            if price is None:
                continue
            total += 1

            if sma200 is not None and price > sma200:
                above_sma200 += 1
            if sma50 is not None and price > sma50:
                above_sma50 += 1
            if macd_hist is not None and macd_hist > 0:
                positive_macd += 1

        if total == 0:
            return {"above_sma200_pct": 50.0, "above_sma50_pct": 50.0, "positive_macd_pct": 50.0}

        return {
            "above_sma200_pct": round(above_sma200 / total * 100, 1),
            "above_sma50_pct": round(above_sma50 / total * 100, 1),
            "positive_macd_pct": round(positive_macd / total * 100, 1),
        }
