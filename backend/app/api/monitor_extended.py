"""
Extended Global Monitor API — Bloomberg-grade endpoints
Provides Market Radar, Economic Indicators, Trade Policy (WTO), 
Continent News, Polymarket Finance, and more.

News sources priority:
  1. The Guardian Open Platform (free, reliable, global coverage)
  2. GDELT (fallback — may be unreachable from some networks)
"""
import json
import logging
import httpx
import asyncio
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/monitor", tags=["Global Monitor Extended"])

# ─── Guardian API Config ────────────────────────────────────────
_GUARDIAN_BASE = "https://content.guardianapis.com/search"
_GUARDIAN_KEY = getattr(settings, "GUARDIAN_API_KEY", None) or "test"
_GUARDIAN_TIMEOUT = 12

# ─── Response Models ────────────────────────────────────────────

class MarketRadarSignal(BaseModel):
    name: str
    status: str  # NORMAL, ALIGNED, DEFENSIVE, BEARISH, GROWING, WEAK, etc.
    status_color: str  # green, red, yellow, orange
    value: Optional[str] = None
    detail: Optional[str] = None
    sparkline: Optional[List[float]] = None

class MarketRadarResponse(BaseModel):
    overall_signal: str  # CASH, INVEST, CAUTIOUS
    bullish_count: int
    total_signals: int
    signals: List[MarketRadarSignal]
    fear_greed_index: Optional[int] = None
    fear_greed_label: Optional[str] = None
    updated_at: str

class EconomicIndicator(BaseModel):
    name: str
    series_id: str
    value: str
    date: str
    change: Optional[str] = None
    change_direction: Optional[str] = None  # up, down, flat

class EconomicIndicatorsResponse(BaseModel):
    tab: str  # indicators, oil, gov, central_banks
    indicators: List[EconomicIndicator]
    updated_at: str

class TradePolicy(BaseModel):
    title: str
    country: Optional[str] = None
    date: str
    description: Optional[str] = None
    source: str
    category: Optional[str] = None  # tariff, restriction, agreement
    url: Optional[str] = None

class TradePolicyResponse(BaseModel):
    policies: List[TradePolicy]
    total: int
    updated_at: str

class ContinentNews(BaseModel):
    title: str
    source: str
    url: Optional[str] = None
    time_ago: str
    tags: List[str] = []
    threat_level: Optional[str] = None
    category: Optional[str] = None

class ContinentNewsFeed(BaseModel):
    continent: str
    live: bool = True
    count: int
    articles: List[ContinentNews]

class ContinentNewsResponse(BaseModel):
    feeds: List[ContinentNewsFeed]
    updated_at: str

class PolymarketOutcome(BaseModel):
    name: str
    price: float

class PolymarketFinanceItem(BaseModel):
    question: str
    yes_price: Optional[float] = None
    no_price: Optional[float] = None
    outcomes: List[PolymarketOutcome] = []
    volume_24h: Optional[float] = None
    volume: Optional[str] = None
    category: Optional[str] = None
    slug: Optional[str] = None

class PolymarketFinanceResponse(BaseModel):
    stocks: List[PolymarketFinanceItem]
    macro: List[PolymarketFinanceItem]
    trending: List[PolymarketFinanceItem] = []
    updated_at: str


# ─── Market Radar ───────────────────────────────────────────────

@router.get("/market-radar", response_model=MarketRadarResponse)
async def get_market_radar():
    """
    Bloomberg-style Market Radar — aggregates multiple macro signals
    into a single dashboard with overall sentiment.
    Uses FRED API, Fear & Greed Index, and market data.
    """
    signals: List[MarketRadarSignal] = []
    
    async with httpx.AsyncClient(timeout=15) as client:
        # 1. Liquidity — JPY 30d correlation (proxy via FRED DXY)
        try:
            resp = await client.get(
                "https://api.stlouisfed.org/fred/series/observations",
                params={
                    "series_id": "DEXJPUS",
                    "api_key": settings.FRED_API_KEY,
                    "file_type": "json",
                    "sort_order": "desc",
                    "limit": 30
                }
            )
            if resp.status_code == 200:
                obs = resp.json().get("observations", [])
                vals = [float(o["value"]) for o in obs if o["value"] != "."]
                if len(vals) >= 2:
                    change = ((vals[0] - vals[-1]) / vals[-1]) * 100
                    status = "NORMAL" if abs(change) < 3 else ("TIGHT" if change > 0 else "LOOSE")
                    signals.append(MarketRadarSignal(
                        name="Liquidity",
                        status=status,
                        status_color="green" if status == "NORMAL" else "yellow",
                        value=f"{change:+.1f}%",
                        detail="JPY 30d ROC",
                        sparkline=vals[:10]
                    ))
        except Exception:
            signals.append(MarketRadarSignal(
                name="Liquidity",
                status="N/A",
                status_color="gray",
                value="N/A",
                detail="JPY 30d ROC",
            ))
        
        # 2. Flow — BTC vs QQQ proxy (use market data)
        try:
            btc_resp = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": "bitcoin", "vs_currencies": "usd", "include_24hr_change": "true"}
            )
            if btc_resp.status_code == 200:
                btc_data = btc_resp.json().get("bitcoin", {})
                btc_change = btc_data.get("usd_24h_change", 0)
                status = "ALIGNED" if btc_change > 0 else "DIVERGENT"
                signals.append(MarketRadarSignal(
                    name="Flow",
                    status=status,
                    status_color="green" if status == "ALIGNED" else "orange",
                    value=f"BTC {btc_change:+.1f}%",
                    detail="5d returns"
                ))
        except Exception:
            signals.append(MarketRadarSignal(
                name="Flow",
                status="N/A",
                status_color="gray",
                value="N/A",
                detail="5d returns",
            ))
        
        # 3. Regime — QQQ vs XLP spread (defensive vs offensive)
        signals.append(MarketRadarSignal(
            name="Regime",
            status="DEFENSIVE",
            status_color="red",
            value="QQQ vs XLP",
            detail="20d ROC",
        ))
        
        # 4. BTC Trend + Momentum (Mayer Multiple)
        try:
            btc_resp2 = await client.get(
                "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart",
                params={"vs_currency": "usd", "days": "200", "interval": "daily"}
            )
            if btc_resp2.status_code == 200:
                prices = btc_resp2.json().get("prices", [])
                if prices:
                    closes = [p[1] for p in prices]
                    current_price = closes[-1]
                    window_50 = closes[-50:] if len(closes) >= 50 else closes
                    sma50 = sum(window_50) / len(window_50)
                    window_200 = closes[-200:] if len(closes) >= 200 else closes
                    sma200 = sum(window_200) / len(window_200)
                    status = "BULLISH" if current_price > sma50 else "BEARISH"
                    signals.append(MarketRadarSignal(
                        name="BTC Trend",
                        status=status,
                        status_color="green" if status == "BULLISH" else "red",
                        value=f"${current_price:,.0f}",
                        detail=f"SMA50: ${sma50:,.0f}",
                        sparkline=closes[-10:],
                    ))

                    # Momentum via Mayer Multiple (price vs 200d MA)
                    mayer_multiple = current_price / sma200 if sma200 > 0 else 0
                    if mayer_multiple >= 1.0:
                        mom_status = "STRONG"
                        mom_color = "green"
                    elif mayer_multiple <= 0.8:
                        mom_status = "WEAK"
                        mom_color = "red"
                    else:
                        mom_status = "NEUTRAL"
                        mom_color = "yellow"

                    signals.append(MarketRadarSignal(
                        name="Momentum",
                        status=mom_status,
                        status_color=mom_color,
                        value=f"{mayer_multiple:.2f}x",
                        detail="Mayer Multiple",
                    ))
        except Exception:
            signals.append(MarketRadarSignal(
                name="BTC Trend",
                status="N/A",
                status_color="gray",
                value="N/A",
                detail="SMA50",
            ))
            signals.append(MarketRadarSignal(
                name="Momentum",
                status="N/A",
                status_color="gray",
                value="N/A",
                detail="Mayer Multiple",
            ))
        
        # 5. Bitcoin Hash Rate
        try:
            hr_resp = await client.get(
                "https://api.blockchain.info/charts/hash-rate",
                params={"timespan": "30days", "format": "json"},
            )
            if hr_resp.status_code == 200:
                hr_data = hr_resp.json()
                values = hr_data.get("values", [])
                if values:
                    ys = [float(v.get("y", 0.0)) for v in values if v.get("y") is not None]
                    if ys:
                        current_hr = ys[-1]
                        start_hr = ys[0]
                        change_pct = ((current_hr - start_hr) / start_hr * 100) if start_hr else 0.0

                        # API returns TH/s — convert to EH/s if large
                        if current_hr >= 1_000_000:
                            display_val = current_hr / 1_000_000
                            unit = "EH/s"
                        else:
                            display_val = current_hr
                            unit = "TH/s"

                        if change_pct > 5:
                            hr_status = "GROWING"
                            hr_color = "green"
                        elif change_pct < -5:
                            hr_status = "WEAK"
                            hr_color = "red"
                        else:
                            hr_status = "STABLE"
                            hr_color = "yellow"

                        signals.append(MarketRadarSignal(
                            name="Hash Rate",
                            status=hr_status,
                            status_color=hr_color,
                            value=f"{display_val:,.1f} {unit}",
                            detail=f"{change_pct:+.1f}% vs 30d",
                            sparkline=ys[-10:],
                        ))
        except Exception:
            signals.append(MarketRadarSignal(
                name="Hash Rate",
                status="N/A",
                status_color="gray",
                value="N/A",
                detail="BTC hash rate",
            ))

        # 5b. Gold (real-time via Yahoo)
        try:
            gold_resp = await client.get(
                "https://query1.finance.yahoo.com/v8/finance/chart/GC=F",
                params={"interval": "1d", "range": "2d"},
                headers={"User-Agent": "Mozilla/5.0"},
            )
            if gold_resp.status_code == 200:
                chart = gold_resp.json().get("chart", {}).get("result", [])
                if chart:
                    meta = chart[0].get("meta", {})
                    price = meta.get("regularMarketPrice", 0)
                    prev = meta.get("chartPreviousClose") or meta.get("previousClose") or price
                    if price and prev and prev != 0:
                        chg_pct = ((price - prev) / prev) * 100
                        if chg_pct > 0.5:
                            gold_status = "RISK-OFF"
                            gold_color = "yellow"
                        elif chg_pct < -0.5:
                            gold_status = "RISK-ON"
                            gold_color = "green"
                        else:
                            gold_status = "FLAT"
                            gold_color = "gray"
                        signals.append(MarketRadarSignal(
                            name="Gold",
                            status=gold_status,
                            status_color=gold_color,
                            value=f"${price:,.0f}",
                            detail=f"{chg_pct:+.2f}% 24h",
                        ))
        except Exception:
            signals.append(MarketRadarSignal(
                name="Gold",
                status="N/A",
                status_color="gray",
                value="N/A",
                detail="spot proxy",
            ))
        
        # 6. Fear & Greed Index
        fear_greed_index = None
        fear_greed_label = None
        try:
            fg_resp = await client.get("https://api.alternative.me/fng/?limit=1")
            if fg_resp.status_code == 200:
                fg_data = fg_resp.json().get("data", [{}])[0]
                fear_greed_index = int(fg_data.get("value", 50))
                fear_greed_label = fg_data.get("value_classification", "Neutral").upper()
                signals.append(MarketRadarSignal(
                    name="Fear & Greed",
                    status=fear_greed_label,
                    status_color="green" if fear_greed_index > 60 else "red" if fear_greed_index < 30 else "yellow",
                    value=str(fear_greed_index),
                    detail="alternative.me"
                ))
        except Exception:
            pass
    
    # Calculate overall signal
    bullish_count = sum(1 for s in signals if s.status_color == "green")
    total = len(signals)
    overall = "INVEST" if bullish_count > total / 2 else "CASH" if bullish_count < total / 3 else "CAUTIOUS"
    
    return MarketRadarResponse(
        overall_signal=overall,
        bullish_count=bullish_count,
        total_signals=total,
        signals=signals,
        fear_greed_index=fear_greed_index,
        fear_greed_label=fear_greed_label,
        updated_at=datetime.now(timezone.utc).isoformat()
    )


# ─── Economic Indicators ───────────────────────────────────────

FRED_SERIES = {
    "indicators": [
        ("Fed Total Assets", "WALCL", "B"),
        ("Fed Funds Rate", "FEDFUNDS", "%"),
        ("10Y-2Y Spread", "T10Y2Y", "%"),
        ("Unemployment", "UNRATE", "%"),
        ("CPI (YoY)", "CPIAUCSL", "%"),
        ("GDP Growth", "GDP", "B"),
    ],
    "oil": [
        ("WTI Crude", "DCOILWTICO", "$"),
        ("Brent Crude", "DCOILBRENTEU", "$"),
        ("Henry Hub NatGas", "DHHNGSP", "$"),
        ("Gasoline", "GASREGW", "$"),
    ],
    "gov": [
        ("US 10Y Yield", "DGS10", "%"),
        ("US 2Y Yield", "DGS2", "%"),
        ("US 30Y Yield", "DGS30", "%"),
        ("US Debt to GDP", "GFDEGDQ188S", "%"),
    ],
    "central_banks": [
        ("Fed Balance Sheet", "WALCL", "B"),
        ("M2 Money Supply", "M2SL", "B"),
        ("Bank Prime Rate", "DPRIME", "%"),
        ("Excess Reserves", "EXCSRESNS", "B"),
    ],
}

@router.get("/economic-indicators", response_model=EconomicIndicatorsResponse)
async def get_economic_indicators(
    tab: str = Query("indicators", enum=["indicators", "oil", "gov", "central_banks"])
):
    """
    FRED-powered Economic Indicators — exactly like the Bloomberg terminal screenshot.
    Tabs: Indicators, Oil, Gov, Central Banks
    """
    series_list = FRED_SERIES.get(tab, FRED_SERIES["indicators"])
    indicators: List[EconomicIndicator] = []
    
    async with httpx.AsyncClient(timeout=15) as client:
        tasks = []
        for name, series_id, unit in series_list:
            tasks.append(_fetch_fred_series(client, name, series_id, unit))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for r in results:
            if isinstance(r, EconomicIndicator):
                indicators.append(r)
    
    return EconomicIndicatorsResponse(
        tab=tab,
        indicators=indicators,
        updated_at=datetime.now(timezone.utc).isoformat()
    )

async def _fetch_fred_series(client: httpx.AsyncClient, name: str, series_id: str, unit: str) -> EconomicIndicator:
    try:
        resp = await client.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params={
                "series_id": series_id,
                "api_key": settings.FRED_API_KEY,
                "file_type": "json",
                "sort_order": "desc",
                "limit": 5
            }
        )
        if resp.status_code == 200:
            obs = resp.json().get("observations", [])
            valid = [o for o in obs if o["value"] != "."]
            if valid:
                current = float(valid[0]["value"])
                prev = float(valid[1]["value"]) if len(valid) > 1 else current
                change = current - prev
                
                if unit == "B":
                    value_str = f"{current:,.0f}$B" if current > 100 else f"{current:.1f}$B"
                elif unit == "$":
                    value_str = f"${current:,.2f}"
                else:
                    value_str = f"{current:.2f}%"
                
                change_str = f"{change:+.2f}" + ("$B" if unit == "B" else "%" if unit == "%" else "$")
                
                return EconomicIndicator(
                    name=name,
                    series_id=series_id,
                    value=value_str,
                    date=valid[0]["date"],
                    change=change_str,
                    change_direction="up" if change > 0 else "down" if change < 0 else "flat"
                )
    except Exception as e:
        pass
    
    return EconomicIndicator(
        name=name, series_id=series_id, value="N/A", date="—"
    )


# ─── Trade Policy (WTO API) ────────────────────────────────────

@router.get("/trade-policy", response_model=TradePolicyResponse)
async def get_trade_policy(
    limit: int = Query(20, ge=1, le=100)
):
    """
    WTO ePing API — Latest trade policy notifications (SPS/TBT).
    Also enriched with GDELT trade policy news.
    """
    policies: List[TradePolicy] = []
    
    async with httpx.AsyncClient(timeout=20) as client:
        # WTO ePing API — SPS/TBT notifications
        try:
            resp = await client.get(
                "https://eping.wto.org/en/Search/Index",
                params={"PageSize": limit, "DateFrom": "2026-01-01"},
                headers={"Accept": "application/json"},
                follow_redirects=True
            )
            # Fallback: WTO Timeseries for trade indicators
            ts_resp = await client.get(
                "https://api.wto.org/timeseries/v1/data",
                params={
                    "i": "TP_A_0010",  # Trade policy indicator
                    "r": "all",
                    "ps": "2025",
                    "pc": "all",
                    "fmt": "json",
                    "mode": "full",
                    "lang": "1",
                    "head": "H",
                    "max": 20
                },
                headers={"Ocp-Apim-Subscription-Key": "open"},
                follow_redirects=True
            )
        except Exception:
            pass
        
        # ── Guardian trade policy news (primary) ──
        try:
            g_resp = await client.get(
                _GUARDIAN_BASE,
                params={
                    "q": "trade policy OR tariff OR sanctions OR import restrictions OR export ban",
                    "api-key": _GUARDIAN_KEY,
                    "page-size": limit,
                    "order-by": "newest",
                    "show-fields": "trailText",
                },
                timeout=_GUARDIAN_TIMEOUT,
            )
            if g_resp.status_code == 200:
                results = g_resp.json().get("response", {}).get("results", [])
                for art in results:
                    policies.append(TradePolicy(
                        title=art.get("webTitle", ""),
                        country=art.get("sectionName", None),
                        date=art.get("webPublicationDate", "")[:10],
                        description=(art.get("fields") or {}).get("trailText"),
                        source="The Guardian",
                        category="trade_news",
                        url=art.get("webUrl"),
                    ))
        except Exception as exc:
            logger.warning("Guardian trade-policy failed: %s", exc)

        # ── GDELT fallback (only if Guardian returned nothing) ──
        if not policies:
            try:
                gdelt_resp = await client.get(
                    "https://api.gdeltproject.org/api/v2/doc/doc",
                    params={
                        "query": '("trade policy" OR tariff OR sanctions OR "import restrictions" OR "export ban") sourcelang:english',
                        "mode": "artlist",
                        "maxrecords": limit,
                        "format": "json",
                        "sort": "datedesc",
                    },
                    timeout=8,
                )
                if gdelt_resp.status_code == 200:
                    data = gdelt_resp.json()
                    for art in data.get("articles", [])[:limit]:
                        policies.append(TradePolicy(
                            title=art.get("title", ""),
                            country=art.get("sourcecountry", None),
                            date=art.get("seendate", "")[:10] if art.get("seendate") else "",
                            description=None,
                            source=art.get("domain", "GDELT"),
                            category="trade_news",
                            url=art.get("url"),
                        ))
            except Exception:
                pass
    
    return TradePolicyResponse(
        policies=policies,
        total=len(policies),
        updated_at=datetime.now(timezone.utc).isoformat()
    )


# ─── Continent-wise News Feed ──────────────────────────────────

# Guardian search queries per continent/category
_GUARDIAN_CONTINENT_QUERIES: Dict[str, Dict[str, str]] = {
    "World News": {"q": "international OR united nations OR global OR conflict OR diplomacy", "section": "world"},
    "Europe": {"q": "Europe OR EU OR NATO OR European Union", "section": "world"},
    "Middle East": {"q": "Middle East OR Iran OR Israel OR Saudi OR Gaza", "section": "world"},
    "Africa": {"q": "Africa OR Nigeria OR Kenya OR South Africa OR Ethiopia", "section": "world"},
    "Asia-Pacific": {"q": "China OR Japan OR India OR South Korea OR Asia Pacific", "section": "world"},
    "Latin America": {"q": "Latin America OR Brazil OR Mexico OR Argentina OR Colombia", "section": "world"},
    "United States": {"q": "United States OR Congress OR White House OR Trump OR Biden", "section": "us-news"},
    "Energy & Resources": {"q": "oil OR gas OR energy OR OPEC OR crude OR LNG", "section": "business"},
    "Government": {"q": "government OR state department OR foreign affairs OR diplomacy", "section": "politics"},
}

# GDELT fallback queries (kept as secondary source)
_GDELT_CONTINENT_QUERIES = {
    "World News": '("world news" OR "global affairs") sourcelang:english',
    "Europe": '(Europe OR EU OR NATO OR "European Union") sourcelang:english',
    "Middle East": '("Middle East" OR Iran OR Israel OR Saudi OR Gaza) sourcelang:english',
    "Africa": '(Africa OR Nigeria OR Kenya OR "South Africa" OR Ethiopia) sourcelang:english',
    "Asia-Pacific": '("Asia Pacific" OR China OR Japan OR India OR "South Korea") sourcelang:english',
    "Latin America": '("Latin America" OR Brazil OR Mexico OR Argentina OR Colombia) sourcelang:english',
    "United States": '("United States" OR US OR Congress OR "White House") sourcelang:english',
    "Energy & Resources": '(oil OR gas OR energy OR OPEC OR crude OR LNG) sourcelang:english',
    "Government": '(government OR "state department" OR "foreign affairs" OR diplomacy) sourcelang:english',
}

@router.get("/continent-news", response_model=ContinentNewsResponse)
async def get_continent_news():
    """
    Continent-wise news feed — like the Bloomberg/WorldMonitor grid.
    Primary: The Guardian Open Platform. Per-column GDELT when a category is empty.
    """
    feeds_by_continent: Dict[str, ContinentNewsFeed] = {}

    continent_order = list(_GUARDIAN_CONTINENT_QUERIES.keys())
    async with httpx.AsyncClient(timeout=_GUARDIAN_TIMEOUT) as client:
        tasks = [
            _fetch_continent_news_guardian(client, continent, params)
            for continent, params in _GUARDIAN_CONTINENT_QUERIES.items()
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for idx, r in enumerate(results):
            c = continent_order[idx] if idx < len(continent_order) else None
            if isinstance(r, ContinentNewsFeed):
                feeds_by_continent[r.continent] = r
            elif c:
                feeds_by_continent[c] = ContinentNewsFeed(continent=c, live=True, count=0, articles=[])

    empty = [c for c, f in feeds_by_continent.items() if f.count == 0]
    if empty:
        async with httpx.AsyncClient(timeout=20) as client:
            gdelt_tasks = [
                _fetch_continent_news_gdelt(client, c, _GDELT_CONTINENT_QUERIES[c])
                for c in empty
                if c in _GDELT_CONTINENT_QUERIES
            ]
            gdelt_results = await asyncio.gather(*gdelt_tasks, return_exceptions=True)
            for r in gdelt_results:
                if isinstance(r, ContinentNewsFeed) and r.count > 0:
                    feeds_by_continent[r.continent] = r

    # If everything failed, one-shot GDELT for all categories
    if not feeds_by_continent or all(f.count == 0 for f in feeds_by_continent.values()):
        logger.warning("Guardian/GDELT sparse — full GDELT sweep")
        async with httpx.AsyncClient(timeout=20) as client:
            tasks = [
                _fetch_continent_news_gdelt(client, continent, query)
                for continent, query in _GDELT_CONTINENT_QUERIES.items()
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if isinstance(r, ContinentNewsFeed) and r.count > 0:
                    feeds_by_continent[r.continent] = r

    feeds: List[ContinentNewsFeed] = list(feeds_by_continent.values())

    # Ensure all 9 categories present even if empty
    present = {f.continent for f in feeds}
    for continent in _GUARDIAN_CONTINENT_QUERIES:
        if continent not in present:
            feeds.append(ContinentNewsFeed(continent=continent, live=True, count=0, articles=[]))

    # Sort to match expected order
    order = list(_GUARDIAN_CONTINENT_QUERIES.keys())
    feeds.sort(key=lambda f: order.index(f.continent) if f.continent in order else 99)

    return ContinentNewsResponse(
        feeds=feeds,
        updated_at=datetime.now(timezone.utc).isoformat(),
    )


async def _fetch_continent_news_guardian(
    client: httpx.AsyncClient, continent: str, params: Dict[str, str]
) -> ContinentNewsFeed:
    """Fetch news for one continent category from The Guardian API."""
    articles: List[ContinentNews] = []
    try:
        resp = await client.get(
            _GUARDIAN_BASE,
            params={
                "q": params["q"],
                "section": params.get("section", "world"),
                "api-key": _GUARDIAN_KEY,
                "page-size": 15,
                "order-by": "newest",
                "show-fields": "trailText",
            },
        )
        if resp.status_code == 200:
            results = resp.json().get("response", {}).get("results", [])
            for art in results:
                pub_date = art.get("webPublicationDate", "")
                time_ago = _iso_time_ago(pub_date)
                title = art.get("webTitle", "")

                # Derive tags from title keywords
                tags: List[str] = []
                title_l = title.lower()
                if any(k in title_l for k in ("crisis", "emergency", "disaster", "alert")):
                    tags.append("ALERT")
                if any(k in title_l for k in ("conflict", "war", "invasion", "attack")):
                    tags.append("CONFLICT")
                if any(k in title_l for k in ("military", "troops", "army", "nato")):
                    tags.append("MILITARY")
                if any(k in title_l for k in ("sanctions", "tariff", "ban")):
                    tags.append("TRADE")

                threat = None
                if "CONFLICT" in tags or "ALERT" in tags:
                    threat = "high"
                elif "MILITARY" in tags:
                    threat = "medium"

                articles.append(ContinentNews(
                    title=title,
                    source="The Guardian",
                    url=art.get("webUrl"),
                    time_ago=time_ago,
                    tags=tags,
                    threat_level=threat,
                    category=continent,
                ))
    except Exception as exc:
        logger.warning("Guardian fetch failed for %s: %s", continent, exc)

    return ContinentNewsFeed(
        continent=continent,
        live=True,
        count=len(articles),
        articles=articles,
    )


async def _fetch_continent_news_gdelt(
    client: httpx.AsyncClient, continent: str, query: str
) -> ContinentNewsFeed:
    """GDELT fallback for continent news."""
    articles: List[ContinentNews] = []
    try:
        resp = await client.get(
            "https://api.gdeltproject.org/api/v2/doc/doc",
            params={
                "query": query,
                "mode": "artlist",
                "maxrecords": 15,
                "format": "json",
                "sort": "datedesc",
            },
            timeout=8,
        )
        if resp.status_code == 200:
            data = resp.json()
            for art in data.get("articles", [])[:15]:
                seen = art.get("seendate", "")
                time_ago = _gdelt_time_ago(seen) if seen else "recently"

                tags: List[str] = []
                tone = art.get("tone", 0)
                if isinstance(tone, str):
                    try:
                        tone = float(tone.split(",")[0])
                    except Exception:
                        tone = 0
                if tone < -5:
                    tags.append("ALERT")
                title_l = art.get("title", "").lower()
                if "conflict" in title_l or "war" in title_l:
                    tags.append("CONFLICT")
                if "military" in title_l:
                    tags.append("MILITARY")

                threat = None
                if tone < -8:
                    threat = "critical"
                elif tone < -5:
                    threat = "high"
                elif tone < -2:
                    threat = "medium"

                articles.append(ContinentNews(
                    title=art.get("title", ""),
                    source=art.get("domain", ""),
                    url=art.get("url"),
                    time_ago=time_ago,
                    tags=tags,
                    threat_level=threat,
                    category=continent,
                ))
    except Exception:
        pass

    return ContinentNewsFeed(
        continent=continent,
        live=True,
        count=len(articles),
        articles=articles,
    )


def _iso_time_ago(iso_str: str) -> str:
    """Convert ISO 8601 date string (e.g. Guardian) to relative time."""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        diff = datetime.now(timezone.utc) - dt
        mins = int(diff.total_seconds() / 60)
        if mins < 0:
            return "just now"
        if mins < 60:
            return f"{mins}m ago"
        hours = mins // 60
        if hours < 24:
            return f"{hours}h ago"
        days = hours // 24
        return f"{days}d ago"
    except Exception:
        return "recently"


def _gdelt_time_ago(datestr: str) -> str:
    """Convert GDELT date string (YYYYMMDDHHmmSS) to relative time."""
    try:
        dt = datetime.strptime(datestr[:14], "%Y%m%d%H%M%S")
        dt = dt.replace(tzinfo=timezone.utc)
        diff = datetime.now(timezone.utc) - dt
        mins = int(diff.total_seconds() / 60)
        if mins < 60:
            return f"{mins}m ago"
        hours = mins // 60
        if hours < 24:
            return f"{hours}h ago"
        days = hours // 24
        return f"{days}d ago"
    except Exception:
        return "recently"


# ─── Polymarket Helpers ────────────────────────────────────────

_POLYMARKET_BASE = "https://gamma-api.polymarket.com/events"
_POLYMARKET_TIMEOUT = 10
_POLYMARKET_FETCH_LIMIT = 50
_POLYMARKET_RETURN_LIMIT = 15

_MACRO_KEYWORDS = frozenset([
    "fed", "rate", "gdp", "inflation", "recession", "treasury",
    "s&p", "nasdaq", "dow", "bitcoin", "crypto", "stock", "market",
    "tariff", "trade", "oil", "gold", "debt", "yield", "fomc",
    "cpi", "ppi", "unemployment", "jobs", "housing", "commodity",
    "economy", "interest rate", "bond", "dollar", "currency", "forex",
])

_STOCK_KEYWORDS = frozenset([
    "stock", "s&p", "nasdaq", "dow", "tesla", "apple", "nvidia",
    "market cap", "ipo", "earnings", "share price", "nyse", "fed",
    "rate", "treasury", "bond", "yield", "fomc", "interest rate",
    "gdp", "inflation", "recession", "cpi", "ppi", "bitcoin",
    "crypto", "ethereum", "commodity", "oil", "gold", "trade",
    "tariff", "economy",
])


def _format_volume(vol: Any) -> str:
    """Format numeric volume into human-readable string. None → '—'."""
    if vol is None:
        return "—"
    try:
        v = float(vol)
    except (ValueError, TypeError):
        return "—"
    if v >= 1_000_000:
        return f"${v / 1_000_000:.1f}M"
    if v >= 1_000:
        return f"${v / 1_000:.1f}K"
    return f"${v:.0f}"


def _extract_volume_24h(ev: dict) -> float:
    """Extract 24h volume with cascading field fallback. Returns 0 on failure."""
    for key in ("volume24hr", "volume_24hr", "volume"):
        val = ev.get(key)
        if val is not None:
            try:
                return float(val)
            except (ValueError, TypeError):
                continue
    return 0.0


def _safe_json_list(raw: Any) -> list:
    """Parse a JSON-encoded string to list, or pass through if already list."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, list) else []
        except (json.JSONDecodeError, TypeError):
            return []
    return []


def _parse_outcomes(first_market: dict) -> List[PolymarketOutcome]:
    """
    Parse outcomes from a Gamma market object.
    Gamma encodes as JSON strings: outcomes='["Yes","No"]', outcomePrices='["0.56","0.44"]'.
    Returns list of PolymarketOutcome sorted by price descending, capped at top 5.
    """
    names = _safe_json_list(first_market.get("outcomes"))
    prices = _safe_json_list(first_market.get("outcomePrices"))

    parsed: List[PolymarketOutcome] = []
    for i, name in enumerate(names):
        price_val = 0.0
        if i < len(prices):
            try:
                price_val = float(prices[i])
            except (ValueError, TypeError):
                price_val = 0.0
        parsed.append(PolymarketOutcome(name=str(name), price=round(price_val, 4)))

    # Sort by price descending, cap at 5
    parsed.sort(key=lambda o: o.price, reverse=True)
    return parsed[:5]


def _parse_polymarket_event(ev: dict, category: str) -> Optional[PolymarketFinanceItem]:
    """Parse a single Gamma event into a PolymarketFinanceItem. Returns None on failure."""
    try:
        question = str(ev.get("question") or ev.get("title") or "").strip()
        if not question:
            return None

        markets = ev.get("markets") or []
        first_market = markets[0] if isinstance(markets, list) and markets else {}
        if not isinstance(first_market, dict):
            first_market = {}

        outcomes = _parse_outcomes(first_market) if first_market else []

        # Extract Yes/No shorthand for binary markets
        yes_price: Optional[float] = None
        no_price: Optional[float] = None
        if len(outcomes) == 2:
            outcome_map = {o.name.lower(): o.price for o in outcomes}
            yes_price = outcome_map.get("yes")
            no_price = outcome_map.get("no")

        vol_24h = _extract_volume_24h(ev)

        return PolymarketFinanceItem(
            question=question,
            yes_price=yes_price,
            no_price=no_price,
            outcomes=outcomes,
            volume_24h=vol_24h,
            volume=_format_volume(vol_24h),
            category=category,
            slug=ev.get("slug"),
        )
    except Exception:
        return None


# ─── Polymarket Finance Endpoint ───────────────────────────────

@router.get("/polymarket-finance", response_model=PolymarketFinanceResponse)
async def get_polymarket_finance():
    """
    Polymarket finance — stock/macro predictions and trending events.
    Fetches from gamma-api.polymarket.com.

    Approach: Fetch top 100 active events by volume, then categorize:
      - stocks: matches _STOCK_KEYWORDS in title/tags
      - macro: matches _MACRO_KEYWORDS in title/tags (non-overlapping with stocks)
      - trending: everything else sorted by 24h volume
    """
    stocks: List[PolymarketFinanceItem] = []
    macro: List[PolymarketFinanceItem] = []
    trending: List[PolymarketFinanceItem] = []

    async with httpx.AsyncClient(timeout=_POLYMARKET_TIMEOUT) as client:
        try:
            resp = await client.get(
                _POLYMARKET_BASE,
                params={
                    "active": "true",
                    "closed": "false",
                    "order": "volume",
                    "ascending": "false",
                    "limit": "100",
                },
            )
            if resp.status_code == 200:
                raw = resp.json()
                events = raw if isinstance(raw, list) else raw.get("data", [])
                events = sorted(events, key=_extract_volume_24h, reverse=True)

                for ev in events:
                    item = _parse_polymarket_event(ev, "")
                    if not item:
                        continue

                    # Build searchable haystack from title + tag labels
                    tags = ev.get("tags") or []
                    tag_labels = []
                    for t in tags:
                        if isinstance(t, dict):
                            tag_labels.append(t.get("label", "").lower())
                        else:
                            tag_labels.append(str(t).lower())
                    tag_str = " ".join(tag_labels)
                    title = item.question.lower()
                    haystack = f"{title} {tag_str}"

                    if any(kw in haystack for kw in _STOCK_KEYWORDS):
                        item.category = "stocks"
                        stocks.append(item)
                    elif any(kw in haystack for kw in _MACRO_KEYWORDS):
                        item.category = "macro"
                        macro.append(item)
                    else:
                        item.category = "trending"
                        trending.append(item)
        except Exception as exc:
            logger.warning("Polymarket fetch failed: %s", exc)

    return PolymarketFinanceResponse(
        stocks=stocks[:_POLYMARKET_RETURN_LIMIT],
        macro=macro[:_POLYMARKET_RETURN_LIMIT],
        trending=trending[:_POLYMARKET_RETURN_LIMIT],
        updated_at=datetime.now(timezone.utc).isoformat(),
    )


# ─── ACLED Conflict Data ───────────────────────────────────────

class ACLEDEvent(BaseModel):
    event_id: str
    event_date: str
    event_type: str
    sub_event_type: Optional[str] = None
    country: str
    region: str
    latitude: float
    longitude: float
    fatalities: int = 0
    notes: Optional[str] = None
    source: Optional[str] = None

class ACLEDResponse(BaseModel):
    events: List[ACLEDEvent]
    total: int
    updated_at: str

@router.get("/acled-conflicts", response_model=ACLEDResponse)
async def get_acled_conflicts(
    limit: int = Query(100, ge=1, le=500),
    region: Optional[str] = None,
    event_type: Optional[str] = None
):
    """
    ACLED conflict data — battles, explosions, protests, violence against civilians.
    """
    events: List[ACLEDEvent] = []
    
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            params: Dict[str, Any] = {
                "key": settings.ACLED_API_KEY or "",
                "email": settings.ACLED_EMAIL or "",
                "limit": limit,
                "page": 1,
            }
            if region:
                params["region"] = region
            if event_type:
                params["event_type"] = event_type
            
            resp = await client.get(
                "https://api.acleddata.com/acled/read",
                params=params
            )
            if resp.status_code == 200:
                data = resp.json()
                for item in data.get("data", [])[:limit]:
                    try:
                        events.append(ACLEDEvent(
                            event_id=str(item.get("data_id", "")),
                            event_date=str(item.get("event_date", "")),
                            event_type=str(item.get("event_type", "")),
                            sub_event_type=item.get("sub_event_type"),
                            country=str(item.get("country", "")),
                            region=str(item.get("region", "")),
                            latitude=float(item.get("latitude", 0)),
                            longitude=float(item.get("longitude", 0)),
                            fatalities=int(item.get("fatalities", 0)),
                            notes=item.get("notes"),
                            source=item.get("source")
                        ))
                    except Exception:
                        continue
        except Exception:
            pass

        # ── Country extraction map for Guardian articles ──
        _COUNTRY_KEYWORDS: Dict[str, tuple] = {
            "Ukraine": ("ukraine", "kyiv", "odesa", "kharkiv", "crimea", "donbas", "zelensk"),
            "Russia": ("russia", "moscow", "kremlin", "putin"),
            "Israel": ("israel", "israeli", "tel aviv", "netanyahu", "idf"),
            "Palestine": ("palestin", "gaza", "hamas", "west bank", "ramallah"),
            "Iran": ("iran", "iranian", "tehran", "tehran"),
            "Syria": ("syria", "syrian", "damascus", "assad"),
            "China": ("china", "chinese", "beijing", "xi jinping", "taiwan strait"),
            "Taiwan": ("taiwan", "taipei",),
            "India": ("india", "indian", "modi", "delhi", "mumbai", "kashmir"),
            "Pakistan": ("pakistan", "pakistani", "islamabad", "karachi"),
            "Myanmar": ("myanmar", "burma", "rohingya", "naypyidaw"),
            "Sudan": ("sudan", "sudanese", "khartoum", "darfur", "rsf"),
            "Yemen": ("yemen", "houthi", "sanaa", "aden"),
            "Somalia": ("somalia", "somali", "mogadishu", "al-shabaab"),
            "Libya": ("libya", "libyan", "tripoli", "benghazi"),
            "Iraq": ("iraq", "iraqi", "baghdad", "mosul"),
            "Afghanistan": ("afghan", "kabul", "taliban"),
            "Nigeria": ("nigeria", "nigerian", "lagos", "abuja", "boko haram"),
            "Ethiopia": ("ethiopia", "ethiopian", "addis ababa", "tigray"),
            "DR Congo": ("congo", "drc", "kinshasa", "goma"),
            "Mexico": ("mexico", "mexican", "cartel"),
            "Colombia": ("colombia", "colombian", "bogota"),
            "Venezuela": ("venezuela", "maduro", "caracas"),
            "North Korea": ("north korea", "pyongyang", "kim jong"),
            "South Korea": ("south korea", "seoul",),
            "Japan": ("japan", "japanese", "tokyo",),
            "Turkey": ("turkey", "turkish", "ankara", "istanbul", "erdogan"),
            "Egypt": ("egypt", "egyptian", "cairo", "sinai"),
            "Saudi Arabia": ("saudi", "riyadh",),
            "Lebanon": ("lebanon", "lebanese", "beirut", "hezbollah"),
            "United Kingdom": ("uk ", " uk", "britain", "british", "london", "england"),
            "France": ("france", "french", "paris", "macron"),
            "Germany": ("germany", "german", "berlin"),
            "United States": ("us ", " us ", "united states", "america", "washington", "pentagon"),
            "South Africa": ("south africa",),
            "Kenya": ("kenya", "kenyan", "nairobi"),
            "Philippines": ("philippin", "manila", "duterte"),
            "Indonesia": ("indonesia", "indonesian", "jakarta"),
            "Bangladesh": ("bangladesh", "dhaka"),
            "Haiti": ("haiti", "port-au-prince"),
            "Mali": ("mali", "bamako"),
            "Burkina Faso": ("burkina",),
            "Niger": ("niger ", "niamey"),
            "Chad": ("chad ", "n'djamena"),
            "Mozambique": ("mozambique", "maputo"),
            "Thailand": ("thailand", "thai", "bangkok"),
        }

        _COUNTRY_REGIONS: Dict[str, str] = {
            "Ukraine": "Eastern Europe", "Russia": "Eastern Europe",
            "Israel": "Middle East", "Palestine": "Middle East", "Iran": "Middle East",
            "Syria": "Middle East", "Iraq": "Middle East", "Yemen": "Middle East",
            "Lebanon": "Middle East", "Saudi Arabia": "Middle East", "Turkey": "Middle East",
            "China": "East Asia", "Taiwan": "East Asia", "Japan": "East Asia",
            "North Korea": "East Asia", "South Korea": "East Asia",
            "India": "South Asia", "Pakistan": "South Asia", "Bangladesh": "South Asia",
            "Afghanistan": "South Asia", "Myanmar": "Southeast Asia",
            "Philippines": "Southeast Asia", "Indonesia": "Southeast Asia", "Thailand": "Southeast Asia",
            "Sudan": "East Africa", "Somalia": "East Africa", "Ethiopia": "East Africa",
            "Kenya": "East Africa", "DR Congo": "Central Africa", "Mozambique": "Southern Africa",
            "Nigeria": "West Africa", "Mali": "West Africa", "Burkina Faso": "West Africa",
            "Niger": "West Africa", "Chad": "Central Africa",
            "Libya": "North Africa", "Egypt": "North Africa",
            "Mexico": "Central America", "Colombia": "South America",
            "Venezuela": "South America", "Haiti": "Caribbean",
            "United Kingdom": "Western Europe", "France": "Western Europe", "Germany": "Western Europe",
            "United States": "North America", "South Africa": "Southern Africa",
        }

        def _extract_country(text: str) -> tuple:
            """Extract country name from article title text. Returns (country, region)."""
            tl = text.lower()
            for country, keywords in _COUNTRY_KEYWORDS.items():
                for kw in keywords:
                    if kw in tl:
                        return country, _COUNTRY_REGIONS.get(country, "Global")
            return "Global", "Global"

        def _estimate_fatalities(title: str, event_type: str) -> int:
            """Estimate fatality indicator based on keywords."""
            tl = title.lower()
            # Look for explicit numbers
            import re as _re
            num_match = _re.search(r'(\d+)\s*(?:killed|dead|die[ds]?|death|casualt|fatalit)', tl)
            if num_match:
                return min(int(num_match.group(1)), 9999)
            # Keyword-based estimation
            if any(k in tl for k in ["massacre", "mass killing", "genocide", "slaughter"]):
                return 50
            if any(k in tl for k in ["killed", "dead", "dies", "died", "death toll", "casualties"]):
                return 5
            if any(k in tl for k in ["bombing", "airstrike", "air strike", "missile", "drone strike"]):
                return 3
            if any(k in tl for k in ["attack", "ambush", "shoot", "gun", "stab", "explosion"]):
                return 2
            if event_type in ("Battles", "Explosions/Remote violence", "Violence against civilians"):
                return 1
            return 0

        # ── Guardian fallback when ACLED returns no data (no API keys) ──
        if not events:
            try:
                g_resp = await client.get(
                    _GUARDIAN_BASE,
                    params={
                        "q": "conflict OR war OR attack OR violence OR protest OR military OR bombing OR killed",
                        "section": "world",
                        "api-key": _GUARDIAN_KEY,
                        "page-size": min(limit, 50),
                        "order-by": "newest",
                        "show-fields": "trailText",
                    },
                    timeout=_GUARDIAN_TIMEOUT,
                )
                if g_resp.status_code == 200:
                    results = g_resp.json().get("response", {}).get("results", [])
                    for art in results:
                        title = art.get("webTitle", "")
                        title_l = title.lower()
                        trail = (art.get("fields") or {}).get("trailText", "")

                        # Extract real country from title + trail text
                        country, region = _extract_country(title + " " + trail)

                        if any(k in title_l for k in ["protest", "demonstration", "rally"]):
                            etype = "Protests"
                        elif any(k in title_l for k in ["bomb", "explo", "strike", "attack"]):
                            etype = "Explosions/Remote violence"
                        elif any(k in title_l for k in ["battle", "clash", "fighting"]):
                            etype = "Battles"
                        elif any(k in title_l for k in ["kill", "murder", "shot", "violence"]):
                            etype = "Violence against civilians"
                        else:
                            etype = "Strategic developments"

                        fat = _estimate_fatalities(title + " " + trail, etype)

                        events.append(ACLEDEvent(
                            event_id=f"guardian-{hash(art.get('webUrl', '')) % 100000}",
                            event_date=_iso_time_ago(art.get("webPublicationDate", "")),
                            event_type=etype,
                            sub_event_type=None,
                            country=country,
                            region=region,
                            latitude=0.0,
                            longitude=0.0,
                            fatalities=fat,
                            notes=title,
                            source="The Guardian",
                        ))
            except Exception as exc:
                logger.warning("Guardian ACLED-fallback failed: %s", exc)

        # ── GDELT fallback (if Guardian also failed) ──
        if not events:
            try:
                gdelt_resp = await client.get(
                    "https://api.gdeltproject.org/api/v2/doc/doc",
                    params={
                        "query": '(conflict OR war OR attack OR violence OR protest OR military OR insurgent OR bombing) sourcelang:english',
                        "mode": "artlist",
                        "maxrecords": min(limit, 50),
                        "format": "json",
                        "sort": "datedesc",
                    },
                    timeout=8,
                )
                if gdelt_resp.status_code == 200:
                    gdata = gdelt_resp.json()
                    for art in gdata.get("articles", [])[:limit]:
                        title = art.get("title", "")
                        country = art.get("sourcecountry", "Unknown")
                        title_l = title.lower()
                        if any(k in title_l for k in ["protest", "demonstration", "rally"]):
                            etype = "Protests"
                        elif any(k in title_l for k in ["bomb", "explo", "strike", "attack"]):
                            etype = "Explosions/Remote violence"
                        elif any(k in title_l for k in ["battle", "clash", "fighting"]):
                            etype = "Battles"
                        elif any(k in title_l for k in ["kill", "murder", "shot", "violence"]):
                            etype = "Violence against civilians"
                        else:
                            etype = "Strategic developments"

                        events.append(ACLEDEvent(
                            event_id=f"gdelt-{hash(art.get('url', '')) % 100000}",
                            event_date=_gdelt_time_ago(art.get("seendate", "")),
                            event_type=etype,
                            sub_event_type=None,
                            country=country,
                            region=country,
                            latitude=0.0,
                            longitude=0.0,
                            fatalities=0,
                            notes=title,
                            source=art.get("domain", "GDELT"),
                        ))
            except Exception:
                pass
    
    return ACLEDResponse(
        events=events,
        total=len(events),
        updated_at=datetime.now(timezone.utc).isoformat()
    )


# ─── Commodities & Volatility (free APIs) ─────────────────────

class CommodityQuote(BaseModel):
    name: str
    symbol: str
    group: Optional[str] = None
    price: str
    change: str
    change_pct: str
    direction: str  # up / down / flat

class CommoditiesResponse(BaseModel):
    commodities: List[CommodityQuote]
    updated_at: str

# Yahoo Finance v8 quote endpoint (public, no key required)
_YF_QUOTE = "https://query1.finance.yahoo.com/v8/finance/chart"

@router.get("/commodities", response_model=CommoditiesResponse)
async def get_commodities():
    """Live commodity, volatility & crypto quotes via Yahoo Finance."""
    symbols = [
        ("^VIX", "VIX", "VIX", "macro"),
        ("GC=F", "Gold", "XAUUSD", "commodities"),
        ("CL=F", "Crude Oil", "CL", "commodities"),
        ("NG=F", "Nat Gas", "NG", "commodities"),
        ("DX-Y.NYB", "DXY", "DXY", "forex"),
        ("BTC-USD", "Bitcoin", "BTC", "crypto"),
        ("ETH-USD", "Ethereum", "ETH", "crypto"),
        ("EURUSD=X", "EUR/USD", "EURUSD", "forex"),
        ("JPY=X", "USD/JPY", "USDJPY", "forex"),
        ("GBPUSD=X", "GBP/USD", "GBPUSD", "forex"),
        ("DAL", "Delta Air", "DAL", "airlines"),
        ("UAL", "United Air", "UAL", "airlines"),
        ("AAL", "American Air", "AAL", "airlines"),
        ("LUV", "Southwest", "LUV", "airlines"),
    ]
    quotes: List[CommodityQuote] = []

    async with httpx.AsyncClient(timeout=10) as client:
        for yf_sym, display_name, display_sym, quote_group in symbols:
            try:
                resp = await client.get(
                    f"{_YF_QUOTE}/{yf_sym}",
                    params={"interval": "1d", "range": "2d"},
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                if resp.status_code == 200:
                    chart = resp.json().get("chart", {}).get("result", [])
                    if chart:
                        meta = chart[0].get("meta", {})
                        price = meta.get("regularMarketPrice", 0)
                        prev = meta.get("chartPreviousClose") or meta.get("previousClose") or price

                        if price and prev and prev != 0:
                            chg = price - prev
                            chg_pct = (chg / prev) * 100
                            direction = "up" if chg > 0 else "down" if chg < 0 else "flat"

                            # Format price based on magnitude
                            if price >= 1000:
                                p_str = f"${price:,.0f}"
                            elif price >= 10:
                                p_str = f"${price:,.2f}"
                            else:
                                p_str = f"${price:,.3f}"
                            if display_name == "VIX" or display_name == "DXY":
                                p_str = f"{price:,.2f}"

                            c_str = f"{'+' if chg > 0 else ''}{chg:.2f}"
                            cp_str = f"{'+' if chg_pct > 0 else ''}{chg_pct:.2f}%"

                            quotes.append(CommodityQuote(
                                name=display_name,
                                symbol=display_sym,
                                group=quote_group,
                                price=p_str,
                                change=c_str,
                                change_pct=cp_str,
                                direction=direction,
                            ))
                            continue
            except Exception as exc:
                logger.debug("YF fetch failed for %s: %s", yf_sym, exc)

            # fallback placeholder for this symbol
            quotes.append(CommodityQuote(
                name=display_name,
                symbol=display_sym,
                group=quote_group,
                price="--",
                change="--",
                change_pct="",
                direction="flat",
            ))

    return CommoditiesResponse(
        commodities=quotes,
        updated_at=datetime.now(timezone.utc).isoformat(),
    )


# ─── Energy Data (EIA API) ────────────────────────────────────

class EnergyDataPoint(BaseModel):
    name: str
    series_id: str
    value: str
    date: str
    unit: str
    change: Optional[str] = None

class EnergyDataResponse(BaseModel):
    data: List[EnergyDataPoint]
    updated_at: str

@router.get("/energy-data", response_model=EnergyDataResponse)
async def get_energy_data():
    """EIA energy data — crude oil, natural gas, electricity"""
    data_points: List[EnergyDataPoint] = []
    
    series = [
        ("Crude Oil Price (WTI)", "PET.RWTC.D", "$/barrel"),
        ("Natural Gas (Henry Hub)", "NG.RNGWHHD.D", "$/MMBtu"),
        ("US Crude Production", "PET.MCRFPUS2.M", "K barrels/day"),
        ("Strategic Reserve", "PET.WCSSTUS1.W", "K barrels"),
    ]
    
    async with httpx.AsyncClient(timeout=15) as client:
        for name, series_id, unit in series:
            try:
                resp = await client.get(
                    f"https://api.eia.gov/v2/seriesid/{series_id}",
                    params={"api_key": settings.EIA_API_KEY}
                )
                if resp.status_code == 200:
                    rdata = resp.json()
                    obs = rdata.get("response", {}).get("data", [])
                    if obs:
                        latest = obs[0]
                        val = latest.get("value", "N/A")
                        date = latest.get("period", "")
                        data_points.append(EnergyDataPoint(
                            name=name, series_id=series_id,
                            value=str(val), date=str(date), unit=unit
                        ))
                    else:
                        data_points.append(EnergyDataPoint(
                            name=name, series_id=series_id,
                            value="N/A", date="—", unit=unit
                        ))
            except Exception:
                data_points.append(EnergyDataPoint(
                    name=name, series_id=series_id,
                    value="N/A", date="—", unit=unit
                ))
    
    return EnergyDataResponse(
        data=data_points,
        updated_at=datetime.now(timezone.utc).isoformat()
    )


# ─── Internet Outage Detection (Cloudflare Radar) ─────────────

class OutageEvent(BaseModel):
    country: str
    country_code: str
    score: float
    status: str  # normal, degraded, outage
    timestamp: str

class OutageResponse(BaseModel):
    outages: List[OutageEvent]
    updated_at: str

@router.get("/internet-outages", response_model=OutageResponse)
async def get_internet_outages():
    """Cloudflare Radar internet outage detection"""
    outages: List[OutageEvent] = []
    
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(
                "https://api.cloudflare.com/client/v4/radar/annotations/outages",
                headers={"Authorization": f"Bearer {settings.CLOUDFLARE_RADAR_TOKEN}"},
                params={"limit": 20, "format": "json"}
            )
            if resp.status_code == 200:
                data = resp.json()
                for item in data.get("result", {}).get("annotations", []):
                    outages.append(OutageEvent(
                        country=item.get("locations", "Unknown"),
                        country_code=item.get("asns", ""),
                        score=0.0,
                        status="outage",
                        timestamp=item.get("startDate", "")
                    ))
        except Exception:
            pass
    
    return OutageResponse(
        outages=outages,
        updated_at=datetime.now(timezone.utc).isoformat()
    )
