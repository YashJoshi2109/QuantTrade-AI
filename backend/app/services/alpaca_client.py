"""
Alpaca Markets Client — Free historical bars + US quotes

Provides:
- Historical OHLCV bars (daily/intraday) for backtesting and candlestick charts
- Real-time US stock quotes (paper or live account)
- No rate limit on historical data (free tier)

Usage:
    from app.services.alpaca_client import alpaca_client

    # Historical bars for backtesting
    df = alpaca_client.get_historical_bars("AAPL", start, end)

    # Real-time quote
    quote = alpaca_client.get_quote("AAPL")
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

import pandas as pd

from app.config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded client singletons
_stock_client = None
_trading_client = None


def _get_stock_client():
    """Lazy-init Alpaca StockHistoricalDataClient."""
    global _stock_client
    if _stock_client is not None:
        return _stock_client
    if not settings.ALPACA_API_KEY or not settings.ALPACA_SECRET_KEY:
        return None
    try:
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.common.exceptions import APIError
        _stock_client = StockHistoricalDataClient(
            api_key=settings.ALPACA_API_KEY,
            secret_key=settings.ALPACA_SECRET_KEY,
        )
        logger.info("Alpaca StockHistoricalDataClient initialized")
        return _stock_client
    except Exception as e:
        logger.warning(f"Alpaca client init failed: {e}")
        return None


def _get_trading_client():
    """Lazy-init Alpaca TradingClient (for account info, not trading)."""
    global _trading_client
    if _trading_client is not None:
        return _trading_client
    if not settings.ALPACA_API_KEY or not settings.ALPACA_SECRET_KEY:
        return None
    try:
        from alpaca.trading.client import TradingClient
        _trading_client = TradingClient(
            api_key=settings.ALPACA_API_KEY,
            secret_key=settings.ALPACA_SECRET_KEY,
            paper=("paper" in settings.ALPACA_BASE_URL),
        )
        return _trading_client
    except Exception as e:
        logger.warning(f"Alpaca TradingClient init failed: {e}")
        return None


ALPACA_DATA_URL = "https://data.alpaca.markets"


def _data_get(path: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """GET on Alpaca's market-data REST API (no SDK needed). None on failure."""
    if not settings.ALPACA_API_KEY or not settings.ALPACA_SECRET_KEY:
        return None
    try:
        import httpx

        r = httpx.get(ALPACA_DATA_URL + path, params=params, timeout=8.0, headers={
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY,
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY,
        })
        if r.status_code != 200:
            logger.debug("Alpaca %s -> HTTP %s", path, r.status_code)
            return None
        return r.json()
    except Exception as e:
        logger.debug(f"Alpaca {path} failed: {e}")
        return None


def _latest_iex_trade(symbol: str) -> Optional[Dict[str, Any]]:
    body = _data_get(f"/v2/stocks/{symbol}/trades/latest", {"feed": "iex"})
    t = (body or {}).get("trade") or {}
    try:
        price = float(t["p"])
    except (KeyError, TypeError, ValueError):
        return None
    if price <= 0 or not t.get("t"):
        return None
    return {"price": price, "time": str(t["t"]).replace("Z", "+00:00")}


class AlpacaClient:
    """Alpaca Markets data client for historical bars and quotes."""

    def get_historical_bars(
        self,
        symbol: str,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        timeframe: str = "1Day",
        adjustment: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Fetch historical OHLCV bars from Alpaca.

        ``adjustment``: Alpaca's default is "raw" (no split/dividend adjustment).
        Backtests pass "all" so a split is not a fake crash.

        Args:
            symbol: Stock ticker (US stocks only)
            start: Start datetime (default: 1 year ago)
            end: End datetime (default: now)
            timeframe: "1Min", "5Min", "15Min", "1Hour", "1Day" (default)

        Returns:
            DataFrame with columns: open, high, low, close, volume
            Empty DataFrame if unavailable.
        """
        client = _get_stock_client()
        if client is None:
            return pd.DataFrame()

        try:
            from alpaca.data.requests import StockBarsRequest
            from alpaca.data.timeframe import TimeFrame

            tf_map = {
                "1Min": TimeFrame.Minute,
                "5Min": TimeFrame(5, "Min") if hasattr(TimeFrame, '__init__') else TimeFrame.Minute,
                "15Min": TimeFrame(15, "Min") if hasattr(TimeFrame, '__init__') else TimeFrame.Minute,
                "1Hour": TimeFrame.Hour,
                "1Day": TimeFrame.Day,
                "1Week": TimeFrame.Week,
                "1Month": TimeFrame.Month,
            }
            tf = tf_map.get(timeframe, TimeFrame.Day)

            if not start:
                start = datetime.now(timezone.utc) - timedelta(days=365)
            if not end:
                end = datetime.now(timezone.utc)

            # Ensure timezone-aware
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)

            req_kwargs = dict(symbol_or_symbols=symbol.upper(), timeframe=tf, start=start, end=end)
            if adjustment:
                req_kwargs["adjustment"] = adjustment
            request = StockBarsRequest(**req_kwargs)

            bars = client.get_stock_bars(request)
            df = bars.df

            if df.empty:
                logger.debug(f"Alpaca: No bars for {symbol}")
                return pd.DataFrame()

            # Reset multi-index (symbol, timestamp) to just timestamp
            if isinstance(df.index, pd.MultiIndex):
                df = df.droplevel("symbol")

            # Standardize column names
            df = df.rename(columns={
                "open": "open",
                "high": "high",
                "low": "low",
                "close": "close",
                "volume": "volume",
            })

            # Remove timezone for consistency with other sources
            if hasattr(df.index, 'tz') and df.index.tz is not None:
                df.index = df.index.tz_localize(None)

            logger.info(f"Alpaca: Fetched {len(df)} bars for {symbol} ({timeframe})")
            return df[["open", "high", "low", "close", "volume"]]

        except Exception as e:
            logger.debug(f"Alpaca bars failed for {symbol}: {e}")
            return pd.DataFrame()

    def get_historical_bars_df(
        self,
        symbol: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        period: str = "1y",
    ) -> pd.DataFrame:
        """
        Convenience wrapper matching DataFetcher.fetch_historical_data() signature.
        Returns DataFrame with columns: timestamp, open, high, low, close, volume
        """
        if not start_date:
            period_map = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825}
            days = period_map.get(period, 365)
            start_date = datetime.now(timezone.utc) - timedelta(days=days)

        df = self.get_historical_bars(symbol, start_date, end_date)
        if df.empty:
            return pd.DataFrame()

        # Convert index to 'timestamp' column for compatibility
        df = df.reset_index()
        if "timestamp" not in df.columns and "date" not in df.columns:
            df.columns = ["timestamp"] + list(df.columns[1:])
        elif "date" in df.columns:
            df = df.rename(columns={"date": "timestamp"})

        return df

    def get_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Quote in the provider-payload shape app.services.canonical_quote reads.

        The free (paper) data plan gives real-time trades from IEX only
        (~2-3% of volume) and consolidated SIP history older than 15 minutes.
        So: the live price is the latest IEX trade, *with its timestamp* (an
        after-hours IEX trade must land in `extended`, not the headline), and
        the regular session's close / previous close / volume / range come
        from SIP daily bars, i.e. the official consolidated figures. The old
        version used the IEX snapshot's daily bar (IEX-only volume, IEX close)
        and no trade time.
        """
        sym = symbol.upper()
        bars = self.get_daily_bars_sip([sym]).get(sym) or []
        trade = _latest_iex_trade(sym)
        if not bars and not trade:
            return None

        from app.services import market_calendar as mc

        payload: Dict[str, Any] = {"symbol": sym, "data_source": "alpaca", "market_cap": None,
                                   "timestamp": datetime.now(timezone.utc).isoformat()}
        if trade:
            payload["price"] = trade["price"]
            payload["market_time"] = trade["time"]
        else:
            # Bars only: the last completed session's close is the price.
            d, *_ = bars[-1]
            payload["price"] = bars[-1][4]
            payload["market_time"] = datetime.combine(d, mc.close_time(d), tzinfo=mc.ET).isoformat()

        from app.services.public_client import reference_session

        ref, session = reference_session(payload)
        by_date = {b[0]: b for b in bars}
        ref_bar = by_date.get(ref)
        if session == mc.REGULAR:
            # Live (or closing) regular-session print: its baseline is the
            # previous session's close; today's partial SIP bar (15 min
            # delayed) carries the consolidated volume / range so far.
            if ref_bar:
                payload["previous_close"] = ref_bar[4]
            today = by_date.get(mc._to_et(datetime.fromisoformat(payload["market_time"])).date())
            if today:
                payload.update(open=today[1], high=today[2], low=today[3], volume=int(today[5]))
        elif ref_bar:
            # Extended-hours print: canonical_quote takes the regular close,
            # the close before it and the session bar from these fields.
            payload["reference_close_date"] = ref.isoformat()
            payload["reference_close"] = ref_bar[4]
            prior = by_date.get(mc.previous_trading_day(ref))
            if prior:
                payload["reference_prior_close"] = prior[4]
            payload["reference_bar"] = {"open": ref_bar[1], "high": ref_bar[2],
                                        "low": ref_bar[3], "volume": ref_bar[5]}
        return payload

    def get_daily_bars_sip(self, symbols, days: int = 14) -> Dict[str, list]:
        """Consolidated (SIP) daily bars per symbol: [(et_date, o, h, l, c, v)],
        oldest first. Ends 16 minutes ago (the free plan's SIP delay)."""
        if not settings.ALPACA_API_KEY or not settings.ALPACA_SECRET_KEY or not symbols:
            return {}
        from app.services import market_calendar as mc

        now = datetime.now(timezone.utc)
        params = {
            "symbols": ",".join(s.upper() for s in symbols),
            "timeframe": "1Day",
            "start": (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end": (now - timedelta(minutes=16)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "feed": "sip",
            "adjustment": "raw",
            "limit": 10000,
        }
        body = _data_get("/v2/stocks/bars", params)
        out: Dict[str, list] = {}
        for sym, rows in ((body or {}).get("bars") or {}).items():
            parsed = []
            for r in rows or []:
                try:
                    ts = datetime.fromisoformat(str(r["t"]).replace("Z", "+00:00"))
                    parsed.append((mc._to_et(ts).date(), float(r["o"]), float(r["h"]),
                                   float(r["l"]), float(r["c"]), float(r["v"])))
                except (KeyError, TypeError, ValueError):
                    continue
            if parsed:
                out[sym.upper()] = sorted(parsed)
        return out

    def get_intraday_bars(
        self,
        symbol: str,
        interval: str = "5Min",
        days_back: int = 1,
    ) -> pd.DataFrame:
        """
        Fetch intraday bars for candlestick charts.

        Args:
            symbol: Stock ticker
            interval: "1Min", "5Min", "15Min", "1Hour"
            days_back: How many days of intraday data (max ~30 for free)
        """
        start = datetime.now(timezone.utc) - timedelta(days=days_back)
        return self.get_historical_bars(symbol, start=start, timeframe=interval)


# Singleton
alpaca_client = AlpacaClient()
