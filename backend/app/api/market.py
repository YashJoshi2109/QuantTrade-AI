"""
Market data API - All stocks, indices, heatmap data

MVP Lean Implementation:
- Uses quote_snapshots cache for real data
- NO fake data - returns unavailable indicator if provider fails
- Tracks SP500 universe for gainers/losers
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional, Tuple
from datetime import datetime, timedelta
import asyncio
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.quote_snapshot import QuoteSnapshot
from app.config import settings
from app.services.quote_cache import QuoteCacheService
from pydantic import BaseModel
import httpx

router = APIRouter()


class StockPerformance(BaseModel):
    symbol: str
    name: str
    price: float
    change: float
    change_percent: float
    volume: int
    market_cap: Optional[float] = None
    sector: Optional[str] = None


class SectorPerformance(BaseModel):
    sector: str
    change_percent: float
    stocks: List[StockPerformance]


class HeatmapData(BaseModel):
    sectors: List[SectorPerformance]
    total_stocks: int
    gainers: int
    losers: int
    unchanged: int


# Major S&P 500 stocks by sector
SP500_STOCKS = {
    "Technology": [
        ("AAPL", "Apple Inc"),
        ("MSFT", "Microsoft Corp"),
        ("NVDA", "NVIDIA Corp"),
        ("GOOGL", "Alphabet Inc"),
        ("META", "Meta Platforms"),
        ("AVGO", "Broadcom Inc"),
        ("ORCL", "Oracle Corp"),
        ("CRM", "Salesforce Inc"),
        ("ADBE", "Adobe Inc"),
        ("AMD", "AMD Inc"),
        ("INTC", "Intel Corp"),
        ("QCOM", "Qualcomm Inc"),
        ("TXN", "Texas Instruments"),
        ("IBM", "IBM Corp"),
        ("NOW", "ServiceNow Inc"),
        ("INTU", "Intuit Inc"),
        ("AMAT", "Applied Materials"),
        ("MU", "Micron Technology"),
        ("ADI", "Analog Devices"),
        ("LRCX", "Lam Research"),
    ],
    "Healthcare": [
        ("UNH", "UnitedHealth Group"),
        ("JNJ", "Johnson & Johnson"),
        ("LLY", "Eli Lilly"),
        ("PFE", "Pfizer Inc"),
        ("ABBV", "AbbVie Inc"),
        ("MRK", "Merck & Co"),
        ("TMO", "Thermo Fisher"),
        ("ABT", "Abbott Labs"),
        ("DHR", "Danaher Corp"),
        ("BMY", "Bristol-Myers Squibb"),
        ("AMGN", "Amgen Inc"),
        ("GILD", "Gilead Sciences"),
        ("CVS", "CVS Health"),
        ("ISRG", "Intuitive Surgical"),
        ("VRTX", "Vertex Pharma"),
    ],
    "Financials": [
        ("JPM", "JPMorgan Chase"),
        ("V", "Visa Inc"),
        ("MA", "Mastercard Inc"),
        ("BAC", "Bank of America"),
        ("WFC", "Wells Fargo"),
        ("GS", "Goldman Sachs"),
        ("MS", "Morgan Stanley"),
        ("BLK", "BlackRock Inc"),
        ("SCHW", "Charles Schwab"),
        ("AXP", "American Express"),
        ("C", "Citigroup Inc"),
        ("SPGI", "S&P Global"),
        ("CME", "CME Group"),
        ("PNC", "PNC Financial"),
        ("USB", "US Bancorp"),
    ],
    "Consumer Cyclical": [
        ("AMZN", "Amazon.com"),
        ("TSLA", "Tesla Inc"),
        ("HD", "Home Depot"),
        ("MCD", "McDonald's Corp"),
        ("NKE", "Nike Inc"),
        ("SBUX", "Starbucks Corp"),
        ("LOW", "Lowe's Companies"),
        ("TJX", "TJX Companies"),
        ("BKNG", "Booking Holdings"),
        ("CMG", "Chipotle Mexican"),
        ("TGT", "Target Corp"),
        ("ORLY", "O'Reilly Auto"),
        ("GM", "General Motors"),
        ("F", "Ford Motor"),
        ("ROST", "Ross Stores"),
    ],
    "Communication Services": [
        ("GOOG", "Alphabet Inc C"),
        ("NFLX", "Netflix Inc"),
        ("DIS", "Walt Disney"),
        ("CMCSA", "Comcast Corp"),
        ("VZ", "Verizon Comms"),
        ("T", "AT&T Inc"),
        ("TMUS", "T-Mobile US"),
        ("CHTR", "Charter Comms"),
        ("EA", "Electronic Arts"),
        ("WBD", "Warner Bros"),
    ],
    "Industrials": [
        ("GE", "General Electric"),
        ("CAT", "Caterpillar Inc"),
        ("UNP", "Union Pacific"),
        ("HON", "Honeywell Intl"),
        ("BA", "Boeing Co"),
        ("RTX", "RTX Corp"),
        ("UPS", "United Parcel"),
        ("DE", "Deere & Co"),
        ("LMT", "Lockheed Martin"),
        ("MMM", "3M Company"),
        ("GD", "General Dynamics"),
        ("CSX", "CSX Corp"),
        ("NSC", "Norfolk Southern"),
        ("FDX", "FedEx Corp"),
        ("EMR", "Emerson Electric"),
    ],
    "Consumer Defensive": [
        ("PG", "Procter & Gamble"),
        ("KO", "Coca-Cola Co"),
        ("PEP", "PepsiCo Inc"),
        ("COST", "Costco Wholesale"),
        ("WMT", "Walmart Inc"),
        ("PM", "Philip Morris"),
        ("MDLZ", "Mondelez Intl"),
        ("MO", "Altria Group"),
        ("CL", "Colgate-Palmolive"),
        ("KMB", "Kimberly-Clark"),
        ("GIS", "General Mills"),
        ("SYY", "Sysco Corp"),
        ("KR", "Kroger Co"),
        ("HSY", "Hershey Co"),
        ("K", "Kellogg Co"),
    ],
    "Energy": [
        ("XOM", "Exxon Mobil"),
        ("CVX", "Chevron Corp"),
        ("COP", "ConocoPhillips"),
        ("EOG", "EOG Resources"),
        ("SLB", "Schlumberger"),
        ("MPC", "Marathon Petrol"),
        ("PXD", "Pioneer Natural"),
        ("PSX", "Phillips 66"),
        ("VLO", "Valero Energy"),
        ("OXY", "Occidental Petrol"),
    ],
    "Utilities": [
        ("NEE", "NextEra Energy"),
        ("DUK", "Duke Energy"),
        ("SO", "Southern Co"),
        ("D", "Dominion Energy"),
        ("AEP", "American Electric"),
        ("EXC", "Exelon Corp"),
        ("XEL", "Xcel Energy"),
        ("SRE", "Sempra Energy"),
        ("ED", "Consolidated Edison"),
        ("WEC", "WEC Energy"),
    ],
    "Real Estate": [
        ("PLD", "Prologis Inc"),
        ("AMT", "American Tower"),
        ("CCI", "Crown Castle"),
        ("EQIX", "Equinix Inc"),
        ("PSA", "Public Storage"),
        ("O", "Realty Income"),
        ("WELL", "Welltower Inc"),
        ("SPG", "Simon Property"),
        ("DLR", "Digital Realty"),
        ("AVB", "AvalonBay Comms"),
    ],
    "Materials": [
        ("LIN", "Linde PLC"),
        ("APD", "Air Products"),
        ("SHW", "Sherwin-Williams"),
        ("ECL", "Ecolab Inc"),
        ("FCX", "Freeport-McMoRan"),
        ("NEM", "Newmont Corp"),
        ("NUE", "Nucor Corp"),
        ("DOW", "Dow Inc"),
        ("DD", "DuPont de Nemours"),
        ("VMC", "Vulcan Materials"),
    ]
}


async def fetch_stock_performance(
    symbol: str, 
    name: str, 
    sector: str, 
    db: Session
) -> Optional[StockPerformance]:
    """
    Fetch real stock performance using QuoteCacheService.
    Returns None if quote is unavailable (NO FAKE DATA).
    """
    cache_service = QuoteCacheService(db)
    
    try:
        quote = await cache_service.get_quote(symbol)
        
        if not quote or quote.get("unavailable"):
            return None
        
        return StockPerformance(
            symbol=symbol,
            name=name,
            price=round(quote.get("price", 0), 2),
            change=round(quote.get("change", 0), 2),
            change_percent=round(quote.get("change_percent", 0), 2),
            volume=int(quote.get("volume", 0)),
            market_cap=quote.get("market_cap"),
            sector=sector
        )
    except Exception as e:
        print(f"Error fetching quote for {symbol}: {e}")
        return None


async def fetch_bulk_quotes(
    symbols_info: List[tuple], 
    db: Session,
    force_refresh: bool = False
) -> List[StockPerformance]:
    """
    Fetch quotes for multiple symbols using cache service.
    Returns list of StockPerformance (only available quotes).
    Uses TradingView as final fallback to ensure we have data.
    """
    cache_service = QuoteCacheService(db)
    results = []
    
    # Extract just symbols for bulk fetch
    symbols = [s[0] for s in symbols_info]
    symbol_map = {s[0]: (s[1], s[2]) for s in symbols_info}  # symbol -> (name, sector)
    
    try:
        # Use force_refresh to bypass stale cache when needed
        quotes = await cache_service.get_quotes(symbols, force_refresh=force_refresh)
        
        # Track symbols that failed to get quotes
        failed_symbols = []
        
        for symbol, quote in quotes.items():
            if quote and not quote.get("unavailable"):
                price = quote.get("price", 0)
                # Only include stocks with valid prices
                if price and price > 0:
                    name, sector = symbol_map.get(symbol, (symbol, None))
                    results.append(StockPerformance(
                        symbol=symbol,
                        name=name,
                        price=round(price, 2),
                        change=round(quote.get("change", 0), 2),
                        change_percent=round(quote.get("change_percent", 0), 2),
                        volume=int(quote.get("volume", 0)),
                        market_cap=quote.get("market_cap"),
                        sector=sector
                    ))
                else:
                    failed_symbols.append(symbol)
            else:
                failed_symbols.append(symbol)
        
        # If we have failed symbols, try TradingView as final fallback
        if failed_symbols:
            try:
                from app.services.tradingview_fetcher import TradingViewFetcher
                tv_quotes = await TradingViewFetcher.get_quotes_bulk(failed_symbols)
                
                for symbol, quote in tv_quotes.items():
                    if quote and quote.get("price") and quote.get("price") > 0:
                        name, sector = symbol_map.get(symbol, (symbol, None))
                        results.append(StockPerformance(
                            symbol=symbol,
                            name=name,
                            price=round(quote.get("price", 0), 2),
                            change=round(quote.get("change", 0), 2),
                            change_percent=round(quote.get("change_percent", 0), 2),
                            volume=int(quote.get("volume", 0)),
                            market_cap=quote.get("market_cap"),
                            sector=sector
                        ))
            except Exception as e:
                print(f"TradingView fallback error: {e}")
                import traceback
                traceback.print_exc()
                
    except Exception as e:
        print(f"Error fetching bulk quotes: {e}")
        import traceback
        traceback.print_exc()
    
    return results


def _flatten_sp500_symbol_rows() -> List[tuple]:
    """All (symbol, name, sector) rows for one bulk quote fetch."""
    rows: List[tuple] = []
    for sector_name, stock_list in SP500_STOCKS.items():
        for symbol, name in stock_list:
            rows.append((symbol, name, sector_name))
    return rows


def _fast_mover_symbol_rows(limit: int = 140) -> List[Tuple[str, str, str]]:
    """
    Fast subset used when full-universe movers are slow.
    Keeps broad sector coverage while returning quickly.
    """
    rows = _flatten_sp500_symbol_rows()
    return [(s[0], s[1], s[2]) for s in rows[:limit]]


def _load_cached_mover_rows(
    db: Session,
    limit: int = 160,
) -> List[StockPerformance]:
    """
    Fastest path for movers: use cached quote_snapshots only (no network).
    """
    rows = _fast_mover_symbol_rows(limit=limit)
    symbol_meta = {s: (n, sec) for s, n, sec in rows}
    symbols = list(symbol_meta.keys())
    snapshots = (
        db.query(QuoteSnapshot)
        .filter(QuoteSnapshot.symbol.in_(symbols))
        .all()
    )

    out: List[StockPerformance] = []
    for snap in snapshots:
        payload = snap.payload or {}
        price = float(payload.get("price", 0) or 0)
        if price <= 0:
            continue
        name, sector = symbol_meta.get(snap.symbol, (snap.symbol, None))
        out.append(
            StockPerformance(
                symbol=snap.symbol,
                name=name,
                price=round(price, 2),
                change=round(float(payload.get("change", 0) or 0), 2),
                change_percent=round(float(payload.get("change_percent", 0) or 0), 2),
                volume=int(payload.get("volume", 0) or 0),
                market_cap=payload.get("market_cap"),
                sector=sector,
            )
        )
    return out


async def _yfinance_fallback_performances(
    db: Session,
    symbols_info: List[Tuple[str, str, str]],
    max_symbols: int = 72,
) -> List[StockPerformance]:
    """
    When cache + TradingView return nothing (cold cache, provider outages), pull a
    slice of the universe directly via yfinance so gainers/losers stay populated.
    """
    cache_service = QuoteCacheService(db)
    batch = symbols_info[:max_symbols]
    sem = asyncio.Semaphore(12)

    async def one(row: Tuple[str, str, str]) -> Optional[StockPerformance]:
        symbol, name, sector = row
        try:
            quote = await cache_service._fetch_from_yfinance(symbol)
            if not quote or quote.get("unavailable"):
                return None
            price = float(quote.get("price", 0) or 0)
            if price <= 0:
                return None
            return StockPerformance(
                symbol=symbol,
                name=name,
                price=round(price, 2),
                change=round(float(quote.get("change", 0) or 0), 2),
                change_percent=round(float(quote.get("change_percent", 0) or 0), 2),
                volume=int(quote.get("volume", 0) or 0),
                market_cap=quote.get("market_cap"),
                sector=sector,
            )
        except Exception as e:
            print(f"yfinance fallback error for {symbol}: {e}")
            return None

    async def guarded(row: Tuple[str, str, str]) -> Optional[StockPerformance]:
        async with sem:
            return await one(row)

    results = await asyncio.gather(*[guarded(r) for r in batch])
    return [r for r in results if r is not None]


async def load_sp500_performances(
    db: Session,
    force_refresh: bool = False,
) -> List[StockPerformance]:
    """
    Load the full S&P watchlist in a single fetch_bulk_quotes call.

    The previous implementation looped every sector and called fetch_bulk_quotes
    once per sector, and get_market_movers called get_top_gainers + get_top_losers
    which duplicated the entire pass — often timing out or returning empty lists.
    """
    symbols_info = [(s[0], s[1], s[2]) for s in _flatten_sp500_symbol_rows()]
    stocks = await fetch_bulk_quotes(symbols_info, db, force_refresh=force_refresh)
    if not stocks and not force_refresh:
        stocks = await fetch_bulk_quotes(symbols_info, db, force_refresh=True)
    if not stocks:
        stocks = await _yfinance_fallback_performances(db, symbols_info)
    return stocks


async def _load_movers_universe(
    db: Session,
    force_refresh: bool = False,
) -> List[StockPerformance]:
    """
    Robust movers loader:
    1) Full S&P pass with timeout guard
    2) Fast subset (cached + force refresh)
    3) yfinance subset fallback
    """
    try:
        return await asyncio.wait_for(
            load_sp500_performances(db, force_refresh=force_refresh),
            timeout=22.0,
        )
    except asyncio.TimeoutError:
        print("load_sp500_performances timed out; using fast movers subset")
    except Exception as e:
        print(f"load_sp500_performances failed; using fast movers subset: {e}")

    fast_rows = _fast_mover_symbol_rows()
    stocks = await fetch_bulk_quotes(fast_rows, db, force_refresh=force_refresh)
    if not stocks and not force_refresh:
        stocks = await fetch_bulk_quotes(fast_rows, db, force_refresh=True)
    if not stocks:
        stocks = await _yfinance_fallback_performances(db, fast_rows, max_symbols=90)
    return stocks


@router.get("/market/ipo-calendar")
async def get_ipo_calendar(
    from_date: Optional[str] = Query(
        None,
        description="ISO date YYYY-MM-DD (default: today UTC)",
    ),
    to_date: Optional[str] = Query(
        None,
        description="ISO date YYYY-MM-DD (default: ~90 days ahead)",
    ),
) -> List[dict]:
    """
    Upcoming IPOs from Finnhub calendar when FINNHUB_API_KEY is set; otherwise [].
    """
    if not settings.FINNHUB_API_KEY:
        return []

    start = from_date or datetime.utcnow().strftime("%Y-%m-%d")
    end = to_date or (datetime.utcnow() + timedelta(days=90)).strftime("%Y-%m-%d")

    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://finnhub.io/api/v1/calendar/ipo",
                params={
                    "from": start,
                    "to": end,
                    "token": settings.FINNHUB_API_KEY,
                },
                timeout=20.0,
            )
            if r.status_code != 200:
                print(f"Finnhub IPO calendar HTTP {r.status_code}")
                return []
            payload = r.json()
    except Exception as e:
        print(f"IPO calendar fetch error: {e}")
        return []

    raw = payload.get("ipoCalendar") or []
    out: List[dict] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        name = row.get("name") or row.get("company") or ""
        dt = row.get("date") or row.get("startDate") or ""
        if not name and not row.get("symbol"):
            continue
        out.append(
            {
                "date": dt,
                "symbol": row.get("symbol"),
                "name": name or row.get("symbol"),
                "exchange": row.get("exchange"),
                "status": row.get("status"),
                "price": row.get("price"),
                "shares": row.get("numberOfShares") or row.get("totalShares"),
            }
        )
    out.sort(key=lambda x: (x.get("date") or ""))
    return out[:40]


@router.get("/market/stocks")
async def get_all_stocks(
    sector: Optional[str] = Query(None, description="Filter by sector"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db)
) -> List[StockPerformance]:
    """
    Get all stocks with real performance data from QuoteCacheService.
    NO FAKE DATA - only returns stocks with available quotes.
    """
    # Build list of symbols to fetch
    symbols_to_fetch = []
    
    for sec, stock_list in SP500_STOCKS.items():
        if sector and sec.lower() != sector.lower():
            continue
            
        for symbol, name in stock_list:
            symbols_to_fetch.append((symbol, name, sec))
    
    # Fetch real quotes using cache service
    stocks = await fetch_bulk_quotes(symbols_to_fetch[:limit], db)
    
    return stocks[:limit]


@router.get("/market/sectors")
async def get_sector_performance(db: Session = Depends(get_db)) -> List[SectorPerformance]:
    """
    Get sector performance with real stock data.
    NO FAKE DATA - only includes stocks with available quotes.
    """
    sectors = []
    
    for sector_name, stock_list in SP500_STOCKS.items():
        # Prepare symbols for this sector
        symbols_info = [(symbol, name, sector_name) for symbol, name in stock_list]
        
        # Fetch real quotes
        stocks = await fetch_bulk_quotes(symbols_info, db)
        
        if not stocks:
            # Skip sectors with no available data
            continue
        
        # Calculate sector average from real data
        avg_change = sum(s.change_percent for s in stocks) / len(stocks)
        
        sectors.append(SectorPerformance(
            sector=sector_name,
            change_percent=round(avg_change, 2),
            stocks=stocks
        ))
    
    # Sort by performance
    sectors.sort(key=lambda x: x.change_percent, reverse=True)
    return sectors


@router.get("/market/heatmap")
async def get_heatmap_data(db: Session = Depends(get_db)) -> HeatmapData:
    """
    Get market heatmap data with real quotes.
    NO FAKE DATA - only includes stocks with available quotes.
    """
    sectors = []
    total_gainers = 0
    total_losers = 0
    total_unchanged = 0
    
    for sector_name, stock_list in SP500_STOCKS.items():
        symbols_info = [(symbol, name, sector_name) for symbol, name in stock_list]
        stocks = await fetch_bulk_quotes(symbols_info, db)
        
        for perf in stocks:
            if perf.change_percent > 0.1:
                total_gainers += 1
            elif perf.change_percent < -0.1:
                total_losers += 1
            else:
                total_unchanged += 1
        
        if stocks:
            avg_change = sum(s.change_percent for s in stocks) / len(stocks)
            sectors.append(SectorPerformance(
                sector=sector_name,
                change_percent=round(avg_change, 2),
                stocks=stocks
            ))
    
    return HeatmapData(
        sectors=sectors,
        total_stocks=total_gainers + total_losers + total_unchanged,
        gainers=total_gainers,
        losers=total_losers,
        unchanged=total_unchanged
    )


@router.get("/market/gainers")
async def get_top_gainers(
    limit: int = Query(10, ge=1, le=50),
    force_refresh: bool = Query(False, description="Force refresh quotes"),
    db: Session = Depends(get_db)
) -> List[StockPerformance]:
    """
    Get top gaining stocks with real data.
    NO FAKE DATA - returns only stocks with available quotes.
    """
    all_stocks = await _load_movers_universe(db, force_refresh=force_refresh)

    # Sort by gain (highest positive change first)
    all_stocks.sort(key=lambda x: x.change_percent, reverse=True)

    # Return only positive gainers (or top movers if no positive gainers)
    gainers = [s for s in all_stocks if s.change_percent > 0]
    if not gainers and all_stocks:
        # Fallback: return top movers by absolute change if no gainers
        gainers = sorted(all_stocks, key=lambda x: abs(x.change_percent), reverse=True)[:limit]

    return gainers[:limit]


@router.get("/market/losers")
async def get_top_losers(
    limit: int = Query(10, ge=1, le=50),
    force_refresh: bool = Query(False, description="Force refresh quotes"),
    db: Session = Depends(get_db)
) -> List[StockPerformance]:
    """
    Get top losing stocks with real data.
    NO FAKE DATA - returns only stocks with available quotes.
    """
    all_stocks = await _load_movers_universe(db, force_refresh=force_refresh)

    # Sort by loss (most negative first)
    all_stocks.sort(key=lambda x: x.change_percent)

    # Return only negative losers (or top movers if no negative losers)
    losers = [s for s in all_stocks if s.change_percent < 0]
    if not losers and all_stocks:
        # Fallback: return top movers by absolute change if no losers
        losers = sorted(all_stocks, key=lambda x: abs(x.change_percent), reverse=True)[:limit]

    return losers[:limit]


@router.get("/market/movers")
async def get_market_movers(
    force_refresh: bool = Query(False, description="Force refresh quotes"),
    db: Session = Depends(get_db)
) -> dict:
    """
    Get market movers (gainers and losers combined) with real data.
    Uses a single quote pass over the universe (fast); do not call gainers+losers endpoints twice.
    """
    # First try cached snapshots only (fast, no provider calls).
    all_stocks = _load_cached_mover_rows(db)

    # If cache is thin/empty, trigger slower refresh path.
    if len(all_stocks) < 12:
        all_stocks = await _load_movers_universe(db, force_refresh=force_refresh)

    sorted_up = sorted(all_stocks, key=lambda x: x.change_percent, reverse=True)
    gainers = [s for s in sorted_up if s.change_percent > 0][:10]
    if not gainers and all_stocks:
        gainers = sorted(all_stocks, key=lambda x: abs(x.change_percent), reverse=True)[:10]

    sorted_down = sorted(all_stocks, key=lambda x: x.change_percent)
    losers = [s for s in sorted_down if s.change_percent < 0][:10]
    if not losers and all_stocks:
        losers = sorted(all_stocks, key=lambda x: abs(x.change_percent), reverse=True)[:10]

    return {
        "gainers": gainers,
        "losers": losers,
        "updated_at": datetime.utcnow().isoformat()
    }
