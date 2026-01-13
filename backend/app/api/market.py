"""
Market data API - All stocks, indices, heatmap data
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from app.db.database import get_db
from app.models.symbol import Symbol
from app.config import settings
from pydantic import BaseModel
import httpx
import random

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


def generate_mock_performance(symbol: str, name: str, sector: str) -> StockPerformance:
    """Generate mock performance data (in production, fetch from API)"""
    base_prices = {
        "AAPL": 261, "MSFT": 420, "NVDA": 185, "GOOGL": 175, "META": 640,
        "AMZN": 242, "TSLA": 448, "AMD": 207, "JPM": 195, "V": 280,
    }
    base_price = base_prices.get(symbol, random.uniform(50, 500))
    change_pct = random.uniform(-5, 5)
    change = base_price * (change_pct / 100)
    
    return StockPerformance(
        symbol=symbol,
        name=name,
        price=round(base_price, 2),
        change=round(change, 2),
        change_percent=round(change_pct, 2),
        volume=random.randint(1000000, 50000000),
        market_cap=random.uniform(10e9, 3e12),
        sector=sector
    )


async def fetch_quote_from_api(symbol: str) -> Optional[dict]:
    """Fetch real quote from Alpha Vantage"""
    if not settings.ALPHA_VANTAGE_API_KEY:
        return None
    
    try:
        url = "https://www.alphavantage.co/query"
        params = {
            "function": "GLOBAL_QUOTE",
            "symbol": symbol,
            "apikey": settings.ALPHA_VANTAGE_API_KEY
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            data = response.json()
        
        if "Global Quote" in data and data["Global Quote"]:
            quote = data["Global Quote"]
            return {
                "price": float(quote.get("05. price", 0)),
                "change": float(quote.get("09. change", 0)),
                "change_percent": float(quote.get("10. change percent", "0%").rstrip('%')),
                "volume": int(quote.get("06. volume", 0))
            }
    except Exception as e:
        print(f"Error fetching quote for {symbol}: {e}")
    
    return None


@router.get("/market/stocks")
async def get_all_stocks(
    sector: Optional[str] = Query(None, description="Filter by sector"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db)
) -> List[StockPerformance]:
    """Get all stocks with performance data"""
    stocks = []
    
    for sec, stock_list in SP500_STOCKS.items():
        if sector and sec.lower() != sector.lower():
            continue
            
        for symbol, name in stock_list[:limit]:
            stocks.append(generate_mock_performance(symbol, name, sec))
    
    return stocks[:limit]


@router.get("/market/sectors")
async def get_sector_performance() -> List[SectorPerformance]:
    """Get sector performance with stocks"""
    sectors = []
    
    for sector_name, stock_list in SP500_STOCKS.items():
        stocks = []
        for symbol, name in stock_list:
            stocks.append(generate_mock_performance(symbol, name, sector_name))
        
        # Calculate sector average
        avg_change = sum(s.change_percent for s in stocks) / len(stocks) if stocks else 0
        
        sectors.append(SectorPerformance(
            sector=sector_name,
            change_percent=round(avg_change, 2),
            stocks=stocks
        ))
    
    # Sort by performance
    sectors.sort(key=lambda x: x.change_percent, reverse=True)
    return sectors


@router.get("/market/heatmap")
async def get_heatmap_data() -> HeatmapData:
    """Get market heatmap data for visualization"""
    sectors = []
    total_gainers = 0
    total_losers = 0
    total_unchanged = 0
    
    for sector_name, stock_list in SP500_STOCKS.items():
        stocks = []
        for symbol, name in stock_list:
            perf = generate_mock_performance(symbol, name, sector_name)
            stocks.append(perf)
            
            if perf.change_percent > 0.1:
                total_gainers += 1
            elif perf.change_percent < -0.1:
                total_losers += 1
            else:
                total_unchanged += 1
        
        avg_change = sum(s.change_percent for s in stocks) / len(stocks) if stocks else 0
        
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
async def get_top_gainers(limit: int = Query(10, ge=1, le=50)) -> List[StockPerformance]:
    """Get top gaining stocks"""
    all_stocks = []
    
    for sector_name, stock_list in SP500_STOCKS.items():
        for symbol, name in stock_list:
            perf = generate_mock_performance(symbol, name, sector_name)
            # Bias toward positive for gainers
            perf.change_percent = abs(perf.change_percent) + random.uniform(0, 3)
            perf.change = perf.price * (perf.change_percent / 100)
            all_stocks.append(perf)
    
    # Sort by gain and return top
    all_stocks.sort(key=lambda x: x.change_percent, reverse=True)
    return all_stocks[:limit]


@router.get("/market/losers")
async def get_top_losers(limit: int = Query(10, ge=1, le=50)) -> List[StockPerformance]:
    """Get top losing stocks"""
    all_stocks = []
    
    for sector_name, stock_list in SP500_STOCKS.items():
        for symbol, name in stock_list:
            perf = generate_mock_performance(symbol, name, sector_name)
            # Bias toward negative for losers
            perf.change_percent = -abs(perf.change_percent) - random.uniform(0, 3)
            perf.change = perf.price * (perf.change_percent / 100)
            all_stocks.append(perf)
    
    # Sort by loss (most negative first)
    all_stocks.sort(key=lambda x: x.change_percent)
    return all_stocks[:limit]


@router.get("/market/movers")
async def get_market_movers() -> dict:
    """Get market movers (gainers and losers combined)"""
    gainers = await get_top_gainers(10)
    losers = await get_top_losers(10)
    
    return {
        "gainers": gainers,
        "losers": losers,
        "updated_at": datetime.utcnow().isoformat()
    }
