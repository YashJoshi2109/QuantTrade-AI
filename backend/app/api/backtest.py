"""
Backtest API — Pro-level backtesting endpoints
Supports single backtest, multi-strategy comparison, and market scanning.
Falls back to yfinance when DB has no price data.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional, Dict, List
from app.db.database import get_db
from app.models.symbol import Symbol
from app.services.backtest_engine import (
    BacktestEngine,
    STRATEGY_REGISTRY,
    rsi_ma_crossover_strategy,
    ma_crossover_strategy,
)
from pydantic import BaseModel, Field
import pandas as pd
import numpy as np

router = APIRouter()


# ── yfinance fallback ─────────────────────────────────────────────────

def _fetch_yfinance_data(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Fetch OHLCV data from yfinance when DB has no data."""
    try:
        import yfinance as yf
        data = yf.download(
            ticker, start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"), progress=False, auto_adjust=True,
        )
        if data.empty:
            return pd.DataFrame()
        # Flatten multi-level columns if present
        if isinstance(data.columns, pd.MultiIndex):
            data.columns = [col[0] if isinstance(col, tuple) else col for col in data.columns]
        df = data.rename(columns={
            "Open": "open", "High": "high", "Low": "low",
            "Close": "close", "Volume": "volume",
        })
        for col in ["open", "high", "low", "close"]:
            if col not in df.columns:
                return pd.DataFrame()
        if "volume" not in df.columns:
            df["volume"] = 0
        df.index = pd.to_datetime(df.index)
        if hasattr(df.index, 'tz') and df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        return df[["open", "high", "low", "close", "volume"]]
    except Exception as e:
        print(f"[backtest] yfinance fallback failed for {ticker}: {e}")
        return pd.DataFrame()


def _fetch_fmp_candles(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Fallback: FMP historical daily candles. Use sparingly (250 calls/day)."""
    try:
        from app.config import settings
        if not settings.FMP_API_KEY:
            return pd.DataFrame()
        import requests
        url = f"https://financialmodelingprep.com/api/v3/historical-price-full/{ticker}"
        resp = requests.get(url, params={
            "apikey": settings.FMP_API_KEY,
            "from": start.strftime("%Y-%m-%d"),
            "to": end.strftime("%Y-%m-%d"),
        }, timeout=15)
        data = resp.json()
        if "historical" not in data or not data["historical"]:
            return pd.DataFrame()
        rows = data["historical"]
        df = pd.DataFrame(rows)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").set_index("date")
        df = df.rename(columns={"adjClose": "close"})
        for col in ["open", "high", "low", "close"]:
            if col not in df.columns:
                return pd.DataFrame()
        if "volume" not in df.columns:
            df["volume"] = 0
        return df[["open", "high", "low", "close", "volume"]]
    except Exception as e:
        print(f"[backtest] FMP fallback failed for {ticker}: {e}")
        return pd.DataFrame()


def _fetch_finnhub_candles(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Fallback: Finnhub stock candles. Use sparingly (60 calls/min)."""
    try:
        from app.config import settings
        if not settings.FINNHUB_API_KEY:
            return pd.DataFrame()
        import requests
        url = "https://finnhub.io/api/v1/stock/candle"
        resp = requests.get(url, params={
            "symbol": ticker,
            "resolution": "D",
            "from": int(start.timestamp()),
            "to": int(end.timestamp()),
            "token": settings.FINNHUB_API_KEY,
        }, timeout=15)
        data = resp.json()
        if data.get("s") != "ok" or not data.get("c"):
            return pd.DataFrame()
        df = pd.DataFrame({
            "open": data["o"], "high": data["h"], "low": data["l"],
            "close": data["c"], "volume": data["v"],
        })
        df.index = pd.to_datetime(data["t"], unit="s")
        if hasattr(df.index, 'tz') and df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        return df
    except Exception as e:
        print(f"[backtest] Finnhub fallback failed for {ticker}: {e}")
        return pd.DataFrame()


def _fetch_price_data(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Fetch price data with fallback chain: yfinance → FMP → Finnhub."""
    # Primary: yfinance (unlimited, free)
    df = _fetch_yfinance_data(ticker, start, end)
    if not df.empty and len(df) >= 20:
        return df
    # Fallback 1: FMP (250/day — use sparingly)
    df = _fetch_fmp_candles(ticker, start, end)
    if not df.empty and len(df) >= 20:
        print(f"[backtest] Using FMP fallback for {ticker}")
        return df
    # Fallback 2: Finnhub (60/min — use sparingly)
    df = _fetch_finnhub_candles(ticker, start, end)
    if not df.empty and len(df) >= 20:
        print(f"[backtest] Using Finnhub fallback for {ticker}")
        return df
    return pd.DataFrame()


def _fetch_benchmark(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Fetch benchmark data for alpha/beta calculation."""
    return _fetch_yfinance_data(ticker, start, end)


# ── Request/Response Models ────────────────────────────────────────────

class BacktestRequest(BaseModel):
    symbol: str
    start_date: str
    end_date: str
    strategy: str = "rsi_ma_crossover"
    initial_capital: float = 10000.0
    strategy_params: Optional[Dict] = None
    position_sizing: str = "fixed"
    commission_rate: float = 0.001
    slippage_rate: float = 0.0005
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    trailing_stop_pct: Optional[float] = None
    max_pyramiding: int = 1
    walk_forward: bool = False
    walk_forward_train_pct: float = 0.7
    monte_carlo: bool = True
    monte_carlo_sims: int = 1000
    benchmark: str = "SPY"


class CompareRequest(BaseModel):
    symbol: str
    start_date: str
    end_date: str
    strategies: List[str]
    initial_capital: float = 10000.0
    commission_rate: float = 0.001
    slippage_rate: float = 0.0005
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    monte_carlo: bool = False


class ScanRequest(BaseModel):
    symbols: List[str]
    strategy: str = "rsi_ma_crossover"
    start_date: str
    end_date: str
    initial_capital: float = 10000.0
    strategy_params: Optional[Dict] = None
    min_sharpe: Optional[float] = None
    min_win_rate: Optional[float] = None
    min_return: Optional[float] = None


# ── Parse dates helper ─────────────────────────────────────────────────

def _parse_dates(start_str: str, end_str: str):
    raw_start = start_str.replace("Z", "").replace("+00:00", "")
    raw_end = end_str.replace("Z", "").replace("+00:00", "")
    start_date = datetime.fromisoformat(raw_start)
    end_date = datetime.fromisoformat(raw_end)
    if start_date >= end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    return start_date, end_date


# ── Core backtest runner (shared logic) ────────────────────────────────

def _run_single_backtest(
    db: Session,
    ticker: str,
    start_date: datetime,
    end_date: datetime,
    strategy: str,
    initial_capital: float,
    strategy_params: Optional[Dict] = None,
    position_sizing: str = "fixed",
    commission_rate: float = 0.001,
    slippage_rate: float = 0.0005,
    stop_loss_pct: Optional[float] = None,
    take_profit_pct: Optional[float] = None,
    trailing_stop_pct: Optional[float] = None,
    max_pyramiding: int = 1,
    walk_forward: bool = False,
    walk_forward_train_pct: float = 0.7,
    monte_carlo: bool = True,
    monte_carlo_sims: int = 1000,
    benchmark_ticker: str = "SPY",
) -> dict:
    """Run a single backtest, falling back to yfinance if DB lacks data."""

    # Always use yfinance as primary — it has ALL US stocks, ETFs, crypto, forex
    # DB is only used as cache optimization, never as primary
    df = _fetch_price_data(ticker, start_date, end_date)
    use_yfinance = True

    if df.empty or len(df) < 20:
        # Last resort: check DB
        symbol_row = db.query(Symbol).filter(Symbol.symbol == ticker.upper()).first()
        if symbol_row:
            from app.services.indicators import IndicatorService
            db_df = IndicatorService.get_price_dataframe(db, symbol_row.id, limit=5000)
            if not db_df.empty:
                if hasattr(db_df.index, 'tz') and db_df.index.tz is not None:
                    db_df.index = db_df.index.tz_localize(None)
                naive_start = start_date.replace(tzinfo=None) if start_date.tzinfo else start_date
                naive_end = end_date.replace(tzinfo=None) if end_date.tzinfo else end_date
                db_df = db_df[(db_df.index >= naive_start) & (db_df.index <= naive_end)].copy()
                if len(db_df) >= 20:
                    df = db_df
                    use_yfinance = False

    if df.empty or len(df) < 20:
        return {"error": f"No price data for {ticker}. Check the ticker symbol or try a different date range."}

    engine = BacktestEngine()
    result = engine.run_backtest_from_df(
        df=df,
        strategy_name=strategy,
        strategy_params=strategy_params,
        initial_capital=initial_capital,
        position_sizing=position_sizing,
        commission_rate=commission_rate,
        slippage_rate=slippage_rate,
        stop_loss_pct=stop_loss_pct,
        take_profit_pct=take_profit_pct,
        trailing_stop_pct=trailing_stop_pct,
        max_pyramiding=max_pyramiding,
        walk_forward=walk_forward,
        walk_forward_train_pct=walk_forward_train_pct,
        monte_carlo=monte_carlo,
        monte_carlo_sims=monte_carlo_sims,
    )

    if "error" in result:
        return result

    # Benchmark comparison (alpha/beta)
    try:
        bench_df = _fetch_benchmark(benchmark_ticker, start_date, end_date)
        if not bench_df.empty and len(bench_df) > 20:
            bench_returns = bench_df["close"].pct_change().dropna().values
            # Align lengths
            eq = np.array(result.get("equity_curve_raw", result.get("equity_curve", [])), dtype=float)
            if len(eq) > 1:
                strat_returns = np.diff(eq) / eq[:-1]
                min_len = min(len(strat_returns), len(bench_returns))
                if min_len > 10:
                    sr = strat_returns[:min_len]
                    br = bench_returns[:min_len]
                    # Beta = Cov(strat, bench) / Var(bench)
                    cov_matrix = np.cov(sr, br)
                    beta = float(cov_matrix[0, 1] / cov_matrix[1, 1]) if cov_matrix[1, 1] > 0 else 0
                    # Alpha (annualized)
                    rf_daily = 0.04 / 252
                    alpha = float((np.mean(sr) - rf_daily - beta * (np.mean(br) - rf_daily)) * 252 * 100)
                    # Benchmark equity curve for overlay
                    bench_eq = [initial_capital]
                    for r in bench_returns[:min_len]:
                        bench_eq.append(bench_eq[-1] * (1 + r))
                    # Sample benchmark curve
                    step = max(1, len(bench_eq) // 300)
                    bench_sampled = [round(bench_eq[i], 2) for i in range(0, len(bench_eq), step)]

                    result["beta"] = round(beta, 3)
                    result["alpha"] = round(alpha, 2)
                    result["benchmark_equity"] = bench_sampled
                    result["benchmark_ticker"] = benchmark_ticker
    except Exception:
        pass

    # Ensure benchmark fields exist
    result.setdefault("beta", 0)
    result.setdefault("alpha", 0)
    result.setdefault("benchmark_equity", [])
    result.setdefault("benchmark_ticker", benchmark_ticker)

    result["symbol"] = ticker.upper()
    result["data_source"] = "yfinance" if use_yfinance else "database"

    return result


# ── Endpoints ──────────────────────────────────────────────────────────

@router.post("/backtest")
async def run_backtest(request: BacktestRequest, db: Session = Depends(get_db)):
    """Run a pro-level backtest with advanced metrics and Monte Carlo validation."""
    try:
        start_date, end_date = _parse_dates(request.start_date, request.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO format.")

    try:
        result = _run_single_backtest(
            db=db,
            ticker=request.symbol,
            start_date=start_date,
            end_date=end_date,
            strategy=request.strategy,
            initial_capital=request.initial_capital,
            strategy_params=request.strategy_params,
            position_sizing=request.position_sizing,
            commission_rate=request.commission_rate,
            slippage_rate=request.slippage_rate,
            stop_loss_pct=request.stop_loss_pct,
            take_profit_pct=request.take_profit_pct,
            trailing_stop_pct=request.trailing_stop_pct,
            max_pyramiding=request.max_pyramiding,
            walk_forward=request.walk_forward,
            walk_forward_train_pct=request.walk_forward_train_pct,
            monte_carlo=request.monte_carlo,
            monte_carlo_sims=request.monte_carlo_sims,
            benchmark_ticker=request.benchmark,
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Backtest engine error: {str(e)}")


@router.post("/backtest/compare")
async def compare_strategies(request: CompareRequest, db: Session = Depends(get_db)):
    """Run multiple strategies on the same symbol and return comparison data."""
    try:
        start_date, end_date = _parse_dates(request.start_date, request.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format.")

    if len(request.strategies) < 2 or len(request.strategies) > 5:
        raise HTTPException(status_code=400, detail="Provide 2-5 strategies for comparison.")

    results = []
    for strat_name in request.strategies:
        if strat_name not in STRATEGY_REGISTRY:
            results.append({"strategy": strat_name, "error": f"Unknown strategy: {strat_name}"})
            continue
        try:
            r = _run_single_backtest(
                db=db, ticker=request.symbol, start_date=start_date, end_date=end_date,
                strategy=strat_name, initial_capital=request.initial_capital,
                commission_rate=request.commission_rate, slippage_rate=request.slippage_rate,
                stop_loss_pct=request.stop_loss_pct, take_profit_pct=request.take_profit_pct,
                monte_carlo=request.monte_carlo, monte_carlo_sims=500,
            )
            r["strategy"] = strat_name
            results.append(r)
        except Exception as e:
            results.append({"strategy": strat_name, "error": str(e)})

    # Correlation matrix between strategy returns
    equity_curves = {}
    for r in results:
        if "error" not in r and "equity_curve" in r:
            equity_curves[r["strategy"]] = r["equity_curve"]

    correlation_matrix = {}
    if len(equity_curves) >= 2:
        strat_names = list(equity_curves.keys())
        for i, s1 in enumerate(strat_names):
            correlation_matrix[s1] = {}
            for j, s2 in enumerate(strat_names):
                eq1 = np.array(equity_curves[s1], dtype=float)
                eq2 = np.array(equity_curves[s2], dtype=float)
                min_len = min(len(eq1), len(eq2))
                if min_len > 2:
                    r1 = np.diff(eq1[:min_len]) / eq1[:min_len - 1]
                    r2 = np.diff(eq2[:min_len]) / eq2[:min_len - 1]
                    corr = float(np.corrcoef(r1, r2)[0, 1]) if len(r1) > 1 else 0
                    correlation_matrix[s1][s2] = round(corr, 3)
                else:
                    correlation_matrix[s1][s2] = 0

    return {
        "symbol": request.symbol.upper(),
        "strategies": results,
        "correlation_matrix": correlation_matrix,
    }


@router.post("/backtest/scan")
async def scan_symbols(request: ScanRequest, db: Session = Depends(get_db)):
    """Scan multiple symbols with a strategy and return ranked results."""
    try:
        start_date, end_date = _parse_dates(request.start_date, request.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format.")

    if len(request.symbols) > 50:
        raise HTTPException(status_code=400, detail="Max 50 symbols per scan.")

    results = []
    for ticker in request.symbols:
        try:
            r = _run_single_backtest(
                db=db, ticker=ticker, start_date=start_date, end_date=end_date,
                strategy=request.strategy, initial_capital=request.initial_capital,
                strategy_params=request.strategy_params,
                monte_carlo=False, walk_forward=False,
            )
            if "error" not in r:
                # Apply filters
                passes = True
                if request.min_sharpe and r.get("sharpe_ratio", 0) < request.min_sharpe:
                    passes = False
                if request.min_win_rate and r.get("win_rate", 0) < request.min_win_rate:
                    passes = False
                if request.min_return and r.get("total_return", 0) < request.min_return:
                    passes = False

                results.append({
                    "symbol": ticker.upper(),
                    "total_return": r.get("total_return", 0),
                    "sharpe_ratio": r.get("sharpe_ratio", 0),
                    "sortino_ratio": r.get("sortino_ratio", 0),
                    "win_rate": r.get("win_rate", 0),
                    "max_drawdown": r.get("max_drawdown", 0),
                    "total_trades": r.get("total_trades", 0),
                    "profit_factor": r.get("profit_factor", 0),
                    "calmar_ratio": r.get("calmar_ratio", 0),
                    "equity_curve": r.get("equity_curve", [])[:50],  # Mini sparkline
                    "passed_filters": passes,
                })
        except Exception:
            continue

    # Sort by Sharpe ratio descending
    results.sort(key=lambda x: x.get("sharpe_ratio", 0), reverse=True)

    return {
        "strategy": request.strategy,
        "total_scanned": len(request.symbols),
        "results_count": len(results),
        "results": results,
    }


# ── Comprehensive US stock directory for autocomplete ──────────────

_US_STOCKS = {
    "AAPL": "Apple Inc", "MSFT": "Microsoft Corp", "GOOGL": "Alphabet Inc", "AMZN": "Amazon.com Inc",
    "NVDA": "NVIDIA Corp", "META": "Meta Platforms", "TSLA": "Tesla Inc", "BRK.B": "Berkshire Hathaway",
    "LLY": "Eli Lilly", "V": "Visa Inc", "JPM": "JPMorgan Chase", "UNH": "UnitedHealth Group",
    "XOM": "Exxon Mobil", "MA": "Mastercard", "JNJ": "Johnson & Johnson", "PG": "Procter & Gamble",
    "AVGO": "Broadcom Inc", "HD": "Home Depot", "COST": "Costco Wholesale", "MRK": "Merck & Co",
    "ABBV": "AbbVie Inc", "KO": "Coca-Cola Co", "PEP": "PepsiCo Inc", "CRM": "Salesforce Inc",
    "WMT": "Walmart Inc", "BAC": "Bank of America", "NFLX": "Netflix Inc", "TMO": "Thermo Fisher",
    "AMD": "Advanced Micro Devices", "CSCO": "Cisco Systems", "ACN": "Accenture plc",
    "LIN": "Linde plc", "ABT": "Abbott Labs", "ORCL": "Oracle Corp", "MCD": "McDonald's Corp",
    "DHR": "Danaher Corp", "ADBE": "Adobe Inc", "TXN": "Texas Instruments", "PM": "Philip Morris",
    "WFC": "Wells Fargo", "INTC": "Intel Corp", "DIS": "Walt Disney", "MS": "Morgan Stanley",
    "NEE": "NextEra Energy", "UPS": "United Parcel Service", "QCOM": "Qualcomm Inc",
    "RTX": "RTX Corp", "AMGN": "Amgen Inc", "GE": "GE Aerospace", "INTU": "Intuit Inc",
    "PFE": "Pfizer Inc", "CAT": "Caterpillar Inc", "IBM": "IBM Corp", "ISRG": "Intuitive Surgical",
    "GS": "Goldman Sachs", "NOW": "ServiceNow", "BKNG": "Booking Holdings", "BLK": "BlackRock Inc",
    "T": "AT&T Inc", "VZ": "Verizon Comms", "SPGI": "S&P Global", "AXP": "American Express",
    "HON": "Honeywell", "SYK": "Stryker Corp", "MDLZ": "Mondelez Intl", "DE": "Deere & Co",
    "GILD": "Gilead Sciences", "SCHW": "Charles Schwab", "BMY": "Bristol-Myers Squibb",
    "LMT": "Lockheed Martin", "AMAT": "Applied Materials", "ADI": "Analog Devices",
    "CB": "Chubb Ltd", "LRCX": "Lam Research", "MMC": "Marsh & McLennan", "ADP": "ADP Inc",
    "VRTX": "Vertex Pharma", "CME": "CME Group", "SLB": "Schlumberger", "TJX": "TJX Companies",
    "ETN": "Eaton Corp", "PLD": "Prologis Inc", "MU": "Micron Technology", "FI": "Fiserv Inc",
    "BSX": "Boston Scientific", "SO": "Southern Co", "CI": "Cigna Group", "DUK": "Duke Energy",
    "KLAC": "KLA Corp", "REGN": "Regeneron Pharma", "MO": "Altria Group", "ICE": "Intercontinental Exchange",
    "SNPS": "Synopsys Inc", "CDNS": "Cadence Design", "CL": "Colgate-Palmolive", "MCK": "McKesson Corp",
    "PYPL": "PayPal Holdings", "SHW": "Sherwin-Williams", "PNC": "PNC Financial",
    "EOG": "EOG Resources", "BDX": "Becton Dickinson", "APD": "Air Products", "NOC": "Northrop Grumman",
    "ZTS": "Zoetis Inc", "CMG": "Chipotle Mexican Grill", "USB": "US Bancorp",
    "ITW": "Illinois Tool Works", "WM": "Waste Management", "CVS": "CVS Health",
    "ORLY": "O'Reilly Automotive", "GD": "General Dynamics", "EMR": "Emerson Electric",
    "ANET": "Arista Networks", "COP": "ConocoPhillips", "TGT": "Target Corp",
    "FCX": "Freeport-McMoRan", "HCA": "HCA Healthcare", "APH": "Amphenol Corp",
    "NSC": "Norfolk Southern", "SRE": "Sempra Energy", "AFL": "Aflac Inc",
    "MCO": "Moody's Corp", "DXCM": "DexCom Inc", "PSX": "Phillips 66", "TFC": "Truist Financial",
    "AEP": "American Electric Power", "D": "Dominion Energy", "EL": "Estée Lauder",
    "AIG": "American Intl Group", "FTNT": "Fortinet Inc", "MPC": "Marathon Petroleum",
    "GM": "General Motors", "F": "Ford Motor Co", "KMB": "Kimberly-Clark", "MCHP": "Microchip Tech",
    "AZO": "AutoZone Inc", "PSA": "Public Storage", "CARR": "Carrier Global",
    "HUM": "Humana Inc", "OXY": "Occidental Petroleum", "VLO": "Valero Energy",
    "NEM": "Newmont Corp", "GIS": "General Mills", "KR": "Kroger Co", "SYY": "Sysco Corp",
    "PCAR": "PACCAR Inc", "ROP": "Roper Technologies", "WELL": "Welltower Inc",
    "STZ": "Constellation Brands", "KDP": "Keurig Dr Pepper", "HSY": "Hershey Co",
    "IDXX": "IDEXX Labs", "ODFL": "Old Dominion Freight", "A": "Agilent Technologies",
    "DHI": "D.R. Horton", "LEN": "Lennar Corp", "FAST": "Fastenal Co", "CTAS": "Cintas Corp",
    "MNST": "Monster Beverage", "AMP": "Ameriprise Financial", "MSCI": "MSCI Inc",
    "PAYX": "Paychex Inc", "CPRT": "Copart Inc", "YUM": "Yum! Brands", "VRSK": "Verisk Analytics",
    "GWW": "W.W. Grainger", "BKR": "Baker Hughes", "CTSH": "Cognizant Tech",
    "ALL": "Allstate Corp", "ROST": "Ross Stores", "EA": "Electronic Arts", "URI": "United Rentals",
    "HAL": "Halliburton Co", "IQV": "IQVIA Holdings", "BIIB": "Biogen Inc",
    "GEHC": "GE HealthCare", "FANG": "Diamondback Energy", "TTWO": "Take-Two Interactive",
    "IT": "Gartner Inc", "LULU": "Lululemon Athletica", "CSGP": "CoStar Group",
    "ON": "ON Semiconductor", "KHC": "Kraft Heinz", "RCL": "Royal Caribbean",
    "EXC": "Exelon Corp", "XEL": "Xcel Energy", "WEC": "WEC Energy",
    "DOW": "Dow Inc", "DD": "DuPont de Nemours", "AWK": "American Water Works",
    "PPG": "PPG Industries", "NDAQ": "Nasdaq Inc", "WST": "West Pharma",
    "OTIS": "Otis Worldwide", "MLM": "Martin Marietta", "VMC": "Vulcan Materials",
    "FTV": "Fortive Corp", "CDW": "CDW Corp", "TSCO": "Tractor Supply",
    "EW": "Edwards Lifesciences", "ROK": "Rockwell Automation", "HPQ": "HP Inc",
    "SBUX": "Starbucks Corp", "NKE": "Nike Inc", "LOW": "Lowe's Companies",
    "BA": "Boeing Co", "UNP": "Union Pacific", "ABNB": "Airbnb Inc",
    "SQ": "Block Inc", "SHOP": "Shopify Inc", "SNAP": "Snap Inc", "UBER": "Uber Technologies",
    "LYFT": "Lyft Inc", "DASH": "DoorDash Inc", "RBLX": "Roblox Corp",
    "COIN": "Coinbase Global", "PLTR": "Palantir Technologies", "SOFI": "SoFi Technologies",
    "RIVN": "Rivian Automotive", "LCID": "Lucid Group", "MARA": "Marathon Digital",
    "MSTR": "MicroStrategy", "HOOD": "Robinhood Markets", "DKNG": "DraftKings",
    "CRWD": "CrowdStrike Holdings", "ZS": "Zscaler Inc", "PANW": "Palo Alto Networks",
    "SNOW": "Snowflake Inc", "DDOG": "Datadog Inc", "NET": "Cloudflare Inc",
    "OKTA": "Okta Inc", "MDB": "MongoDB Inc", "TEAM": "Atlassian Corp",
    "WDAY": "Workday Inc", "VEEV": "Veeva Systems", "HUBS": "HubSpot Inc",
    "TTD": "The Trade Desk", "U": "Unity Software", "PATH": "UiPath Inc",
    "LPLA": "LPL Financial", "RJF": "Raymond James", "IBKR": "Interactive Brokers",
    "NTNX": "Nutanix Inc", "SMCI": "Super Micro Computer", "ARM": "Arm Holdings",
    "CEG": "Constellation Energy", "VST": "Vistra Corp", "MRVL": "Marvell Technology",
    "DELL": "Dell Technologies", "HPE": "Hewlett Packard Enterprise",
    "WBD": "Warner Bros Discovery", "PARA": "Paramount Global",
    "CAG": "Conagra Brands", "CPB": "Campbell Soup", "HRL": "Hormel Foods",
    "BBY": "Best Buy Co", "ETSY": "Etsy Inc", "W": "Wayfair Inc",
    "CHWY": "Chewy Inc", "DG": "Dollar General", "DLTR": "Dollar Tree",
    "FIVE": "Five Below", "TJX": "TJX Companies", "RVMD": "Revolution Medicines",
    "AKAM": "Akamai Technologies", "CC": "Chemours Co", "CE": "Celanese Corp",
}


@router.get("/backtest/symbols")
async def search_backtest_symbols(q: str = Query("", min_length=1), limit: int = Query(12, le=30)):
    """Search symbols for backtest — uses built-in directory + yfinance validation.
    Works for ALL US stocks, ETFs, crypto, and forex without DB dependency."""
    query = q.strip().upper()
    max_results = int(limit)
    if not query:
        return {"results": []}

    results = []

    # 1. Search built-in directory (instant, no API call)
    for ticker, name in _US_STOCKS.items():
        if query in ticker or query in name.upper():
            results.append({"symbol": ticker, "name": name, "source": "directory"})
        if len(results) >= max_results:
            break

    # 2. If few results, also search DB
    if len(results) < max_results:
        try:
            from app.db.database import SessionLocal
            db = SessionLocal()
            try:
                db_results = db.query(Symbol).filter(
                    (Symbol.symbol.ilike(f"%{query}%")) | (Symbol.name.ilike(f"%{query}%"))
                ).limit(max_results - len(results)).all()
                seen = {r["symbol"] for r in results}
                for s in db_results:
                    if s.symbol not in seen:
                        results.append({
                            "symbol": s.symbol, "name": s.name or "",
                            "exchange": s.exchange or "", "source": "database"
                        })
                        seen.add(s.symbol)
            finally:
                db.close()
        except Exception:
            pass

    # 3. If still few results and query looks like a valid ticker, try yfinance
    if len(results) < 3 and len(query) >= 2:
        try:
            import yfinance as yf
            info = yf.Ticker(query).info
            if info and info.get("regularMarketPrice") or info.get("shortName"):
                seen = {r["symbol"] for r in results}
                sym = info.get("symbol", query)
                if sym not in seen:
                    results.insert(0, {
                        "symbol": sym,
                        "name": info.get("shortName", info.get("longName", "")),
                        "exchange": info.get("exchange", ""),
                        "source": "yfinance"
                    })
        except Exception:
            pass

    return {"results": results[:max_results]}


@router.get("/strategies")
async def get_strategies():
    """Return all available strategies with descriptions and default parameters."""
    strategies = []
    for name, info in STRATEGY_REGISTRY.items():
        strategies.append({
            "id": name,
            "name": name.replace("_", " ").title(),
            "description": info["description"],
            "category": info["category"],
            "default_params": info["default_params"],
        })
    return {"strategies": strategies}
