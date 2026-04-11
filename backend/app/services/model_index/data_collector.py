"""
Model Index Engine — Data Collector

Aggregates data from all existing services (QuoteCacheService, FinvizFetcher,
FMP, IndicatorService, RiskScorer, DB models) into a unified StockData dict
for downstream scoring engines.
"""

import logging
import asyncio
import numpy as np
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta

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


class DataCollector:
    """
    Collects and normalizes data from multiple sources into a unified
    StockData dictionary per ticker.
    """

    def __init__(self, db: Session):
        self.db = db
        self.quote_service = QuoteCacheService(db)

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
            return {}

    def _get_risk(self, symbol_id: int) -> Dict:
        """Compute risk metrics."""
        try:
            return RiskScorer.calculate_risk_score(self.db, symbol_id)
        except Exception as e:
            logger.debug(f"Risk scoring failed for symbol_id={symbol_id}: {e}")
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

    async def collect_stock(self, ticker: str, market_prices: Optional[List[float]] = None) -> Dict[str, Any]:
        """
        Collect all available data for one ticker from DB and services.
        Returns a unified StockData dict. Missing data is None.
        """
        ticker = ticker.upper()
        data: Dict[str, Any] = {
            "ticker": ticker,
            "company_name": None,
            "sector": get_sector_for_ticker(ticker),
            "industry": None,
        }

        # 1. Symbol record from DB
        sym = self._get_symbol_record(ticker)
        if sym:
            data["company_name"] = sym.name
            if sym.sector:
                data["sector"] = sym.sector
            data["industry"] = getattr(sym, "industry", None)
            symbol_id = sym.id
        else:
            data["data_completeness"] = 0.0
            data["_symbol_found"] = False
            return data

        data["_symbol_found"] = True

        # 2. Quote (latest price)
        try:
            quotes = await self.quote_service.get_quotes([ticker])
            q = quotes.get(ticker, {})
            if isinstance(q, dict):
                data["price"] = _sf(q.get("price"))
                data["change_pct"] = _sf(q.get("change_percent"))
                data["volume"] = _sf(q.get("volume"))
                data["market_cap"] = _sf(q.get("market_cap"))
        except Exception as e:
            logger.debug(f"Quote fetch failed for {ticker}: {e}")

        # 3. Fundamentals from DB (cached from Finviz/FMP)
        fund = self._get_fundamentals(symbol_id)
        if fund:
            data["company_name"] = data["company_name"] or fund.company_name
            data["sector"] = data["sector"] or fund.sector or get_sector_for_ticker(ticker)
            data["industry"] = data["industry"] or fund.industry
            data["pe_ratio"] = _sf(fund.pe_ratio)
            data["forward_pe"] = _sf(fund.forward_pe)
            data["peg_ratio"] = _sf(fund.peg_ratio)
            data["price_to_sales"] = _sf(fund.price_to_sales)
            data["price_to_book"] = _sf(fund.price_to_book)
            data["ev_to_ebitda"] = _sf(fund.ev_to_ebitda)
            data["dividend_yield"] = _sf(fund.dividend_yield)
            data["profit_margin"] = _sf(fund.profit_margin)
            data["operating_margin"] = _sf(fund.operating_margin)
            data["gross_margin"] = _sf(fund.gross_margin)
            data["roa"] = _sf(fund.roa)
            data["roe"] = _sf(fund.roe)
            data["roi"] = _sf(fund.roi)
            data["roic"] = _sf(fund.roic)
            data["debt_to_equity"] = _sf(fund.debt_to_equity)
            data["current_ratio"] = _sf(fund.current_ratio)
            data["quick_ratio"] = _sf(fund.quick_ratio)
            data["eps"] = _sf(fund.eps)
            data["eps_next_quarter"] = _sf(fund.eps_next_quarter)
            data["eps_next_year"] = _sf(fund.eps_next_year)
            data["revenue"] = _sf(fund.revenue)
            data["quarterly_revenue_growth"] = _sf(fund.quarterly_revenue_growth)
            data["quarterly_earnings_growth"] = _sf(fund.quarterly_earnings_growth)
            data["beta"] = _sf(fund.beta)
            data["short_float"] = _sf(fund.short_float)
            data["insider_ownership"] = _sf(fund.insider_ownership)
            data["institutional_ownership"] = _sf(fund.institutional_ownership)
            data["target_price"] = _sf(fund.target_price)
            data["recommendation"] = fund.recommendation
            data["analyst_rating"] = _sf(fund.analyst_rating)
            data["shares_outstanding"] = _sf(fund.shares_outstanding)
            data["earnings_date"] = fund.earnings_date
            data["market_cap"] = data.get("market_cap") or _sf(fund.market_cap)
            data["price"] = data.get("price") or _sf(fund.price)
            data["avg_volume"] = _sf(fund.avg_volume)
            data["week_52_high"] = _sf(fund.week_52_high)
            data["week_52_low"] = _sf(fund.week_52_low)

        # 4. Technical indicators
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
            # Use indicator price if quote price missing
            data["price"] = data.get("price") or data.get("current_price_ind")

        # 5. Risk metrics
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

        # 6. Compute real beta from price history if we have market prices
        if market_prices:
            stock_prices = self._get_price_history(symbol_id, 252)
            real_beta = self._compute_beta(stock_prices, market_prices)
            if real_beta is not None:
                data["beta"] = real_beta

            # Compute downside deviation
            returns = self._compute_returns(stock_prices)
            if returns:
                neg_returns = [r for r in returns if r < 0]
                if neg_returns:
                    data["downside_deviation"] = float(np.std(neg_returns) * np.sqrt(252) * 100)

        # 7. Data quality score
        data["data_completeness"] = self._compute_data_completeness(data)

        return data

    async def collect_universe(
        self,
        tickers: Optional[List[str]] = None,
        max_concurrent: int = 10,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Batch collect data for the full universe (or a subset).
        Uses semaphore to control concurrency.
        """
        if tickers is None:
            tickers = get_full_universe()

        # First, get SPY price history for beta calculation
        spy_sym = self._get_symbol_record("SPY")
        market_prices = None
        if spy_sym:
            market_prices = self._get_price_history(spy_sym.id, 252)

        results: Dict[str, Dict[str, Any]] = {}
        semaphore = asyncio.Semaphore(max_concurrent)

        async def _collect_one(t: str):
            async with semaphore:
                try:
                    return t, await self.collect_stock(t, market_prices)
                except Exception as e:
                    logger.warning(f"Failed to collect data for {t}: {e}")
                    return t, {"ticker": t, "data_completeness": 0.0, "_symbol_found": False}

        tasks = [_collect_one(t) for t in tickers]
        completed = await asyncio.gather(*tasks, return_exceptions=True)

        for item in completed:
            if isinstance(item, Exception):
                continue
            ticker, stock_data = item
            results[ticker] = stock_data

        logger.info(
            f"Data collection complete: {len(results)}/{len(tickers)} tickers, "
            f"avg completeness: {np.mean([d.get('data_completeness', 0) for d in results.values()]):.1f}%"
        )
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

        # VIX
        try:
            vix_quotes = await self.quote_service.get_quotes(["^VIX"])
            vix_data = vix_quotes.get("^VIX", {})
            if isinstance(vix_data, dict):
                macro["vix"] = _sf(vix_data.get("price"))
        except Exception:
            pass

        # SPY for reference
        try:
            spy_quotes = await self.quote_service.get_quotes(["SPY"])
            spy_data = spy_quotes.get("SPY", {})
            if isinstance(spy_data, dict):
                macro["spy_price"] = _sf(spy_data.get("price"))
        except Exception:
            pass

        # Treasury yield proxies (TLT as bond proxy)
        try:
            tlt_quotes = await self.quote_service.get_quotes(["TLT"])
            tlt_data = tlt_quotes.get("TLT", {})
            if isinstance(tlt_data, dict):
                macro["tlt_price"] = _sf(tlt_data.get("price"))
        except Exception:
            pass

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
