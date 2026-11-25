"""
Price data API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from app.services.sync_rate_limit import sync_rate_limit
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.price import PriceBar
from app.services.data_fetcher import DataFetcher
from app.services.ticker_validation import normalize_ticker
from app.config import settings
from pydantic import BaseModel
import httpx
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


class PriceBarResponse(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int
    
    class Config:
        from_attributes = True


# Daily-bar history policy for /prices/{symbol}
MAX_BACKFILL_DAYS = 3 * 365          # never backfill more than ~3 years
DEFAULT_BACKFILL_DAYS = 2 * 365      # default history for a fresh symbol
_SYNC_RETRY_SECONDS = 3600           # don't re-hit upstream for the same gap within 1h
_last_sync_attempt: dict = {}


def _last_trading_day(now_utc: Optional[datetime] = None):
    """Most recent US trading session date whose daily bar should exist.

    Before ~16:30 ET the current session's bar is not final, so the previous
    weekday is used. Exchange holidays are not modelled; on a holiday this
    asks for one extra refresh, which the retry throttle keeps cheap.
    """
    from datetime import timedelta, timezone
    import pytz

    now_utc = now_utc or datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    et = now_utc.astimezone(pytz.timezone("America/New_York"))
    day = et.date()
    if et.hour < 16 or (et.hour == 16 and et.minute < 30):
        day -= timedelta(days=1)
    while day.weekday() >= 5:  # Sat/Sun -> Friday
        day -= timedelta(days=1)
    return day


def _query_bars(db: Session, symbol_id: int, start, end, limit: int):
    """Return up to `limit` bars, newest kept, in ascending time order."""
    query = db.query(PriceBar).filter(PriceBar.symbol_id == symbol_id)
    if start:
        query = query.filter(PriceBar.timestamp >= start)
    if end:
        query = query.filter(PriceBar.timestamp <= end)
    bars = query.order_by(PriceBar.timestamp.desc()).limit(limit).all()
    bars.reverse()
    return bars


def _should_attempt(key) -> bool:
    import time as _time
    last = _last_sync_attempt.get(key)
    now = _time.monotonic()
    if last is not None and now - last < _SYNC_RETRY_SECONDS:
        return False
    _last_sync_attempt[key] = now
    return True


@router.get("/prices/{symbol}", response_model=List[PriceBarResponse])
def get_prices(
    symbol: str,
    start: Optional[datetime] = Query(None, description="Start date"),
    end: Optional[datetime] = Query(None, description="End date"),
    limit: int = Query(500, ge=1, le=5000, description="Max number of bars"),
    auto_sync: bool = Query(True, description="Automatically sync data if not available"),
    db: Session = Depends(get_db)
):
    """
    Get daily price bars for a symbol (ascending by time, newest `limit` kept).

    With auto_sync the stored history is kept fresh:
    - no bars at all -> backfill (requested range, or ~2y / enough for `limit`)
    - stored history shorter than requested -> backfill the missing older span
    - newest bar older than the last completed trading day -> refresh the tail

    Plain `def` so FastAPI runs the blocking DB/yfinance work in its threadpool.
    Unknown tickers return 404 (no Symbol row is created).
    """
    from datetime import timedelta, timezone

    symbol_upper = normalize_ticker(symbol)
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol_upper).first()
    if not db_symbol:
        if not auto_sync:
            raise HTTPException(status_code=404, detail=f"Unknown ticker: {symbol_upper}")
        # Validates upstream and raises UnknownTickerError (404) for junk tickers.
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol_upper)

    bars = _query_bars(db, db_symbol.id, start, end, limit)
    if not auto_sync:
        return bars

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    synced = False
    try:
        if start or end:
            # Explicit range: only fill when nothing is stored for it.
            if not bars and _should_attempt((symbol_upper, "range", start, end)):
                sync_start = start or (end or now) - timedelta(days=DEFAULT_BACKFILL_DAYS)
                sync_end = end or now
                synced = DataFetcher.sync_price_data_to_db(
                    db, symbol_upper, sync_start, sync_end + timedelta(days=1)) > 0
        else:
            # ~252 trading days/year -> calendar span needed for `limit` bars.
            want_days = min(MAX_BACKFILL_DAYS, max(DEFAULT_BACKFILL_DAYS, int(limit * 1.46) + 7))
            want_start = now - timedelta(days=want_days)
            oldest = bars[0].timestamp.replace(tzinfo=None) if bars else None
            newest = bars[-1].timestamp.replace(tzinfo=None) if bars else None

            if not bars or (len(bars) < limit and oldest > want_start + timedelta(days=7)):
                if _should_attempt((symbol_upper, "backfill")):
                    # Fresh symbol: fetch through today. Otherwise fill the older gap only.
                    backfill_end = (oldest + timedelta(days=1)) if oldest else now + timedelta(days=1)
                    synced |= DataFetcher.sync_price_data_to_db(
                        db, symbol_upper, want_start, backfill_end) > 0

            if newest is not None and newest.date() < _last_trading_day():
                if _should_attempt((symbol_upper, "refresh", _last_trading_day())):
                    synced |= DataFetcher.sync_price_data_to_db(
                        db, symbol_upper, newest - timedelta(days=5), now + timedelta(days=1)) > 0
    except HTTPException:
        raise
    except Exception as e:
        # Upstream failure: serve whatever is stored rather than erroring.
        db.rollback()
        logger.error(f"Error syncing price data for {symbol_upper}: {e}", exc_info=True)

    if synced:
        bars = _query_bars(db, db_symbol.id, start, end, limit)

    if not bars:
        logger.warning(f"No price bars found for {symbol_upper} in range {start} to {end}")
    return bars


@router.get("/prices/{symbol}/intraday", response_model=List[PriceBarResponse])
async def get_intraday_prices(
    symbol: str,
    interval: str = Query("5m", description="Interval: 1m, 5m, 15m, 1h"),
    days: int = Query(1, ge=1, le=30, description="Days of intraday data"),
    extended_hours: bool = Query(False, description="Include pre-market and after-hours data"),
):
    """
    Get intraday OHLCV bars for candlestick charts.

    Fallback chain: yfinance → Alpaca → Twelve Data → Finnhub → Alpha Vantage
    - 1m: max 7 days (yfinance), 30 days (Alpaca), 3mo (Finnhub)
    - 5m: max 60 days (yfinance), 30 days (Alpaca), 60 days (Twelve Data)
    """
    symbol_upper = symbol.upper()
    bars = []

    # 1. yfinance (free, no key required)
    try:
        import yfinance as yf
        import asyncio

        def _fetch_yf():
            period = f"{days}d"
            # yfinance interval names: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h
            yf_interval = interval.replace("min", "m").replace("hour", "h")
            if yf_interval == "1h":
                yf_interval = "60m"
            data = yf.download(symbol_upper, period=period, interval=yf_interval, progress=False, prepost=extended_hours)
            if data.empty:
                return []
            import pandas as pd
            if isinstance(data.columns, pd.MultiIndex):
                data.columns = [col[0] if isinstance(col, tuple) else col for col in data.columns]
            data = data.rename(columns={
                "Open": "open", "High": "high", "Low": "low",
                "Close": "close", "Volume": "volume",
            })
            # Convert index to UTC so frontend always receives UTC timestamps
            if hasattr(data.index, 'tz') and data.index.tz is not None:
                data.index = data.index.tz_convert('UTC')
            else:
                # Assume ET (US market hours) if no timezone info
                import pytz
                try:
                    data.index = data.index.tz_localize('America/New_York').tz_convert('UTC')
                except Exception:
                    pass  # Already localized or ambiguous
            result = []
            for ts, row in data.iterrows():
                ts_dt = ts.to_pydatetime()
                # Ensure timezone-aware (UTC)
                if ts_dt.tzinfo is None:
                    import pytz
                    ts_dt = ts_dt.replace(tzinfo=pytz.UTC)
                result.append(PriceBarResponse(
                    timestamp=ts_dt,
                    open=round(float(row.get("open", 0)), 2),
                    high=round(float(row.get("high", 0)), 2),
                    low=round(float(row.get("low", 0)), 2),
                    close=round(float(row.get("close", 0)), 2),
                    volume=int(row.get("volume", 0)),
                ))
            return result

        import asyncio
        bars = await asyncio.to_thread(_fetch_yf)
        if bars:
            logger.info(f"Intraday {interval}: {len(bars)} bars for {symbol_upper} via yfinance")
            return bars
    except Exception as e:
        logger.debug(f"yfinance intraday failed for {symbol_upper}: {e}")

    # 2. Alpaca (free historical bars)
    try:
        import asyncio

        def _fetch_alpaca():
            from app.services.alpaca_client import alpaca_client
            tf_map = {"1m": "1Min", "5m": "5Min", "15m": "15Min", "1h": "1Hour"}
            tf = tf_map.get(interval, "5Min")
            df = alpaca_client.get_intraday_bars(symbol_upper, interval=tf, days_back=days)
            if df.empty:
                return []
            result = []
            for ts, row in df.iterrows():
                result.append(PriceBarResponse(
                    timestamp=ts.to_pydatetime() if hasattr(ts, 'to_pydatetime') else ts,
                    open=round(float(row["open"]), 2),
                    high=round(float(row["high"]), 2),
                    low=round(float(row["low"]), 2),
                    close=round(float(row["close"]), 2),
                    volume=int(row["volume"]),
                ))
            return result

        bars = await asyncio.to_thread(_fetch_alpaca)
        if bars:
            logger.info(f"Intraday {interval}: {len(bars)} bars for {symbol_upper} via Alpaca")
            return bars
    except Exception as e:
        logger.debug(f"Alpaca intraday failed for {symbol_upper}: {e}")

    # 3. Twelve Data (800 credits/day)
    if settings.TWELVEDATA_API_KEY:
        try:
            td_interval = interval.replace("m", "min").replace("h", "h")
            if td_interval == "1min":
                td_interval = "1min"
            elif td_interval == "5min":
                td_interval = "5min"
            url = f"https://api.twelvedata.com/time_series?symbol={symbol_upper}&interval={td_interval}&outputsize={days * 390}&apikey={settings.TWELVEDATA_API_KEY}"
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url)
                data = resp.json()
            if data.get("status") == "ok" and data.get("values"):
                bars = []
                for v in reversed(data["values"]):
                    bars.append(PriceBarResponse(
                        timestamp=datetime.fromisoformat(v["datetime"]),
                        open=round(float(v["open"]), 2),
                        high=round(float(v["high"]), 2),
                        low=round(float(v["low"]), 2),
                        close=round(float(v["close"]), 2),
                        volume=int(v.get("volume", 0)),
                    ))
                if bars:
                    logger.info(f"Intraday {interval}: {len(bars)} bars for {symbol_upper} via Twelve Data")
                    return bars
        except Exception as e:
            logger.debug(f"Twelve Data intraday failed for {symbol_upper}: {e}")

    # 4. Finnhub stock candles (60 calls/min)
    if settings.FINNHUB_API_KEY:
        try:
            from datetime import timedelta
            import time as _time

            resolution_map = {"1m": "1", "5m": "5", "15m": "15", "1h": "60"}
            resolution = resolution_map.get(interval, "5")
            end_ts = int(_time.time())
            start_ts = end_ts - (days * 86400)

            url = "https://finnhub.io/api/v1/stock/candle"
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, params={
                    "symbol": symbol_upper,
                    "resolution": resolution,
                    "from": start_ts,
                    "to": end_ts,
                    "token": settings.FINNHUB_API_KEY,
                })
                data = resp.json()
            if data.get("s") == "ok" and data.get("c"):
                bars = []
                for i in range(len(data["c"])):
                    bars.append(PriceBarResponse(
                        timestamp=datetime.fromtimestamp(data["t"][i], tz=__import__('pytz').UTC),
                        open=round(float(data["o"][i]), 2),
                        high=round(float(data["h"][i]), 2),
                        low=round(float(data["l"][i]), 2),
                        close=round(float(data["c"][i]), 2),
                        volume=int(data["v"][i]),
                    ))
                if bars:
                    logger.info(f"Intraday {interval}: {len(bars)} bars for {symbol_upper} via Finnhub")
                    return bars
        except Exception as e:
            logger.debug(f"Finnhub intraday failed for {symbol_upper}: {e}")

    # 5. Alpha Vantage TIME_SERIES_INTRADAY (25 calls/day — last resort)
    if settings.ALPHA_VANTAGE_API_KEY:
        try:
            av_interval = interval.replace("m", "min").replace("h", "60min")
            if av_interval not in ("1min", "5min", "15min", "30min", "60min"):
                av_interval = "5min"
            url = "https://www.alphavantage.co/query"
            params = {
                "function": "TIME_SERIES_INTRADAY",
                "symbol": symbol_upper,
                "interval": av_interval,
                "outputsize": "compact",
                "apikey": settings.ALPHA_VANTAGE_API_KEY,
            }
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, params=params)
                data = resp.json()
            ts_key = f"Time Series ({av_interval})"
            if ts_key in data and data[ts_key]:
                bars = []
                for dt_str, v in sorted(data[ts_key].items()):
                    bars.append(PriceBarResponse(
                        timestamp=datetime.fromisoformat(dt_str),
                        open=round(float(v["1. open"]), 2),
                        high=round(float(v["2. high"]), 2),
                        low=round(float(v["3. low"]), 2),
                        close=round(float(v["4. close"]), 2),
                        volume=int(v["5. volume"]),
                    ))
                if bars:
                    logger.info(f"Intraday {interval}: {len(bars)} bars for {symbol_upper} via Alpha Vantage")
                    return bars
        except Exception as e:
            logger.debug(f"Alpha Vantage intraday failed for {symbol_upper}: {e}")

    return bars


@router.post("/prices/{symbol}/sync", dependencies=[Depends(sync_rate_limit)])
def sync_prices(
    symbol: str,
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    db: Session = Depends(get_db)
):
    """Sync price data for a symbol"""
    try:
        symbol_upper = normalize_ticker(symbol)
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol_upper)
        
        # If no date range provided, default to last 3 months
        if not start or not end:
            from datetime import timedelta
            end = datetime.utcnow()
            start = end - timedelta(days=90)
        
        logger.info(f"Syncing price data for {symbol_upper} from {start} to {end}")
        count = DataFetcher.sync_price_data_to_db(db, symbol_upper, start, end)
        
        # If sync returned 0, try without date range to get any available data
        if count == 0:
            logger.info(f"No data synced with date range for {symbol_upper}, trying without date range...")
            count = DataFetcher.sync_price_data_to_db(db, symbol_upper)
        
        return {
            "symbol": symbol_upper,
            "bars_inserted": count,
            "message": f"Price data synced successfully. Inserted {count} bars."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error syncing price data for {symbol}: {e}", exc_info=True)
        logger.exception("Failed to sync price data")
        raise HTTPException(status_code=500, detail="Failed to sync price data")


@router.get("/prices/{symbol}/quote")
async def get_quote(symbol: str, db: Session = Depends(get_db)):
    """Get live quote for a symbol from Alpha Vantage"""
    try:
        # Try Alpha Vantage GLOBAL_QUOTE
        if settings.ALPHA_VANTAGE_API_KEY:
            url = "https://www.alphavantage.co/query"
            params = {
                "function": "GLOBAL_QUOTE",
                "symbol": symbol.upper(),
                "apikey": settings.ALPHA_VANTAGE_API_KEY
            }
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, params=params)
                data = response.json()
            
            if "Global Quote" in data and data["Global Quote"]:
                quote = data["Global Quote"]
                return {
                    "symbol": quote.get("01. symbol", symbol.upper()),
                    "price": float(quote.get("05. price", 0)),
                    "change": float(quote.get("09. change", 0)),
                    "change_percent": float(quote.get("10. change percent", "0%").rstrip('%')),
                    "volume": int(quote.get("06. volume", 0)),
                    "high": float(quote.get("03. high", 0)),
                    "low": float(quote.get("04. low", 0)),
                    "open": float(quote.get("02. open", 0)),
                    "previous_close": float(quote.get("08. previous close", 0)),
                    "timestamp": quote.get("07. latest trading day", datetime.now().isoformat())
                }
        
        # Fallback to database
        db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
        if db_symbol:
            latest_bar = db.query(PriceBar).filter(
                PriceBar.symbol_id == db_symbol.id
            ).order_by(PriceBar.timestamp.desc()).first()
            
            if latest_bar:
                # Get previous bar for change calculation
                prev_bar = db.query(PriceBar).filter(
                    PriceBar.symbol_id == db_symbol.id,
                    PriceBar.timestamp < latest_bar.timestamp
                ).order_by(PriceBar.timestamp.desc()).first()
                
                change = 0
                change_pct = 0
                if prev_bar:
                    change = latest_bar.close - prev_bar.close
                    change_pct = (change / prev_bar.close) * 100 if prev_bar.close else 0
                
                return {
                    "symbol": symbol.upper(),
                    "price": latest_bar.close,
                    "change": change,
                    "change_percent": change_pct,
                    "volume": latest_bar.volume,
                    "high": latest_bar.high,
                    "low": latest_bar.low,
                    "open": latest_bar.open,
                    "previous_close": prev_bar.close if prev_bar else latest_bar.open,
                    "timestamp": latest_bar.timestamp.isoformat()
                }
        
        # Return empty quote
        return {
            "symbol": symbol.upper(),
            "price": 0,
            "change": 0,
            "change_percent": 0,
            "volume": 0,
            "high": 0,
            "low": 0,
            "open": 0,
            "previous_close": 0,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.exception("Failed to fetch quote")
        raise HTTPException(status_code=500, detail="Failed to fetch quote")
