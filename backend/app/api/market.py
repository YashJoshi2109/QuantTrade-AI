"""
Market data API - All stocks, indices, heatmap data

MVP Lean Implementation:
- Uses quote_snapshots cache for real data
- NO fake data - returns unavailable indicator if provider fails
- Tracks SP500 universe for gainers/losers
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from app.db.database import get_db
from app.models.symbol import Symbol
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
    db: Session
) -> List[StockPerformance]:
    """
    Fetch quotes for multiple symbols using cache service.
    Returns list of StockPerformance (only available quotes).
    """
    cache_service = QuoteCacheService(db)
    results = []
    
    # Extract just symbols for bulk fetch
    symbols = [s[0] for s in symbols_info]
    symbol_map = {s[0]: (s[1], s[2]) for s in symbols_info}  # symbol -> (name, sector)
    
    try:
        quotes = await cache_service.get_quotes(symbols)
        
        for symbol, quote in quotes.items():
            if quote and not quote.get("unavailable"):
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
        print(f"Error fetching bulk quotes: {e}")
    
    return results


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
    db: Session = Depends(get_db)
) -> List[StockPerformance]:
    """
    Get top gaining stocks with real data.
    NO FAKE DATA - returns only stocks with available quotes.
    """
    all_stocks = []
    
    for sector_name, stock_list in SP500_STOCKS.items():
        symbols_info = [(symbol, name, sector_name) for symbol, name in stock_list]
        stocks = await fetch_bulk_quotes(symbols_info, db)
        all_stocks.extend(stocks)
    
    # Sort by gain (highest positive change first)
    all_stocks.sort(key=lambda x: x.change_percent, reverse=True)
    
    # Return only positive gainers
    gainers = [s for s in all_stocks if s.change_percent > 0]
    return gainers[:limit]


@router.get("/market/losers")
async def get_top_losers(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
) -> List[StockPerformance]:
    """
    Get top losing stocks with real data.
    NO FAKE DATA - returns only stocks with available quotes.
    """
    all_stocks = []
    
    for sector_name, stock_list in SP500_STOCKS.items():
        symbols_info = [(symbol, name, sector_name) for symbol, name in stock_list]
        stocks = await fetch_bulk_quotes(symbols_info, db)
        all_stocks.extend(stocks)
    
    # Sort by loss (most negative first)
    all_stocks.sort(key=lambda x: x.change_percent)
    
    # Return only negative losers
    losers = [s for s in all_stocks if s.change_percent < 0]
    return losers[:limit]


@router.get("/market/movers")
async def get_market_movers(db: Session = Depends(get_db)) -> dict:
    """
    Get market movers (gainers and losers combined) with real data.
    """
    gainers = await get_top_gainers(10, db)
    losers = await get_top_losers(10, db)
    
    return {
        "gainers": gainers,
        "losers": losers,
        "updated_at": datetime.utcnow().isoformat()
    }
