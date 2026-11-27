"""
Backtest API: named-strategy backtests (single, compare, scan) on the audited
engine in ``app.services.backtesting``.

Data: split/dividend-adjusted daily bars (yfinance -> Alpaca -> FMP ->
Finnhub, see ``backtesting/data.py``), with an indicator warm-up fetched
before ``start_date`` so the first tradable bar already has valid indicators.

All handlers are plain ``def`` (run in the threadpool, never on the event
loop) and every request is bounded (``backtesting/limits.py``).
"""
import logging
import time
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from app.api.auth import _guard_token
from app.db.database import get_db
from app.models.symbol import Symbol
from app.services.backtest_engine import (
    BacktestEngine,
    STRATEGY_REGISTRY,
    max_lookback,
    rsi_ma_crossover_strategy,
    ma_crossover_strategy,
)
from app.services.backtesting import data as bt_data
from app.services.backtesting import limits as L
from pydantic import BaseModel, Field, field_validator, model_validator
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

router = APIRouter()

TICKER_PATTERN = r"^[A-Za-z0-9.\-^=]{1,15}$"


# ── Price data (thin wrappers kept for tests / monkeypatching) ─────────

def _fetch_alpaca_candles(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    return bt_data.fetch_alpaca(ticker, start, end)


def _fetch_fmp_candles(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    return bt_data.fetch_fmp(ticker, start, end)


def _fetch_price_data(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    ps = bt_data.load_prices(ticker, start, end)
    return ps.df if ps is not None else pd.DataFrame()


def _fetch_benchmark(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    return _fetch_price_data(ticker, start, end)


# ── Request/Response Models ────────────────────────────────────────────

def _check_params(strategy: str, params: Optional[Dict]) -> Optional[Dict]:
    if params is None:
        return None
    if strategy not in STRATEGY_REGISTRY:
        return params  # unknown strategy is reported by the endpoint
    defaults = STRATEGY_REGISTRY[strategy]["default_params"]
    out = {}
    for k, v in params.items():
        if k not in defaults:
            raise ValueError(f"unknown parameter '{k}' for {strategy}")
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ValueError(f"parameter '{k}' must be a number")
        if isinstance(defaults[k], int) and not isinstance(defaults[k], bool):
            if float(v) != int(v) or not 1 <= int(v) <= L.MAX_WINDOW:
                raise ValueError(f"parameter '{k}' must be an integer between 1 and {L.MAX_WINDOW}")
            v = int(v)
        elif not -1e4 <= float(v) <= 1e4:
            raise ValueError(f"parameter '{k}' is out of range")
        out[k] = v
    return out


def _check_range(start: str, end: str):
    s, e = _parse_iso(start), _parse_iso(end)
    if s >= e:
        raise ValueError("start_date must be before end_date")
    if (e - s).days > L.MAX_YEARS * 366:
        raise ValueError(f"date range is limited to {L.MAX_YEARS} years")
    if s.year < 1970:
        raise ValueError("start_date must be 1970 or later")


class BacktestRequest(BaseModel):
    symbol: str = Field(pattern=TICKER_PATTERN)
    start_date: str
    end_date: str
    strategy: str = "rsi_ma_crossover"
    initial_capital: float = Field(10000.0, gt=0, le=L.MAX_CAPITAL)
    strategy_params: Optional[Dict] = None
    position_sizing: str = Field("fixed", pattern=r"^(fixed|kelly|volatility)$")
    commission_rate: float = Field(0.001, ge=0, le=L.MAX_COST_BPS / 1e4)
    slippage_rate: float = Field(0.0005, ge=0, le=L.MAX_COST_BPS / 1e4)
    stop_loss_pct: Optional[float] = Field(None, gt=0, lt=100)
    take_profit_pct: Optional[float] = Field(None, gt=0, le=1000)
    trailing_stop_pct: Optional[float] = Field(None, gt=0, lt=100)
    max_pyramiding: int = Field(1, ge=1, le=5)
    walk_forward: bool = False
    walk_forward_train_pct: float = Field(0.7, ge=0.3, le=0.9)
    monte_carlo: bool = True
    monte_carlo_sims: int = Field(1000, ge=50, le=L.MAX_MC_SIMS)
    benchmark: str = Field("SPY", pattern=TICKER_PATTERN)

    @model_validator(mode="after")
    def _bounds(self):
        _check_range(self.start_date, self.end_date)
        self.strategy_params = _check_params(self.strategy, self.strategy_params)
        return self


class CompareRequest(BaseModel):
    symbol: str = Field(pattern=TICKER_PATTERN)
    start_date: str
    end_date: str
    strategies: List[str] = Field(min_length=2, max_length=5)
    initial_capital: float = Field(10000.0, gt=0, le=L.MAX_CAPITAL)
    commission_rate: float = Field(0.001, ge=0, le=L.MAX_COST_BPS / 1e4)
    slippage_rate: float = Field(0.0005, ge=0, le=L.MAX_COST_BPS / 1e4)
    stop_loss_pct: Optional[float] = Field(None, gt=0, lt=100)
    take_profit_pct: Optional[float] = Field(None, gt=0, le=1000)
    monte_carlo: bool = False

    @model_validator(mode="after")
    def _bounds(self):
        _check_range(self.start_date, self.end_date)
        return self


class ScanRequest(BaseModel):
    symbols: List[str] = Field(min_length=1, max_length=L.MAX_SCAN_SYMBOLS)
    strategy: str = "rsi_ma_crossover"
    start_date: str
    end_date: str
    initial_capital: float = Field(10000.0, gt=0, le=L.MAX_CAPITAL)
    strategy_params: Optional[Dict] = None
    min_sharpe: Optional[float] = None
    min_win_rate: Optional[float] = None
    min_return: Optional[float] = None

    @field_validator("symbols")
    @classmethod
    def _syms(cls, v):
        import re
        for s in v:
            if not re.match(TICKER_PATTERN, s):
                raise ValueError(f"invalid symbol {s!r}")
        return v

    @model_validator(mode="after")
    def _bounds(self):
        _check_range(self.start_date, self.end_date)
        self.strategy_params = _check_params(self.strategy, self.strategy_params)
        return self


# ── Parse dates helper ─────────────────────────────────────────────────

def _parse_iso(value: str) -> datetime:
    raw = value.replace("Z", "").replace("+00:00", "")
    return datetime.fromisoformat(raw)


def _parse_dates(start_str: str, end_str: str):
    start_date = _parse_iso(start_str)
    end_date = _parse_iso(end_str)
    if start_date >= end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    return start_date, end_date


def warmup_start(start: datetime, bars: int) -> datetime:
    return start - timedelta(days=int(bars * L.WARMUP_CALENDAR_FACTOR) + 10)


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
    deadline: Optional[float] = None,
) -> dict:
    """Fetch adjusted bars (with indicator warm-up) and run one named strategy."""
    if strategy not in STRATEGY_REGISTRY:
        return {"error": f"Unknown strategy: {strategy}"}
    params = {**STRATEGY_REGISTRY[strategy]["default_params"], **(strategy_params or {})}
    fetch_start = warmup_start(start_date, max_lookback(params) + 5)
    df = _fetch_price_data(ticker, fetch_start, end_date)
    if df.empty or len(df[df.index >= pd.Timestamp(start_date)]) < 20:
        return {"error": f"No price data for {ticker}. Check the ticker symbol or try a different date range."}
    df, warns = bt_data.validate_ohlcv(df, ticker.upper())

    bench_close = None
    try:
        bdf = _fetch_benchmark(benchmark_ticker, start_date, end_date)
        if bdf is not None and not bdf.empty:
            bench_close = bt_data.validate_ohlcv(bdf, benchmark_ticker)[0]["close"]
    except Exception:
        bench_close = None

    result = BacktestEngine().run_backtest_from_df(
        df=df, strategy_name=strategy, strategy_params=strategy_params,
        initial_capital=initial_capital, position_sizing=position_sizing,
        commission_rate=commission_rate, slippage_rate=slippage_rate,
        stop_loss_pct=stop_loss_pct, take_profit_pct=take_profit_pct,
        trailing_stop_pct=trailing_stop_pct, max_pyramiding=max_pyramiding,
        walk_forward=walk_forward, walk_forward_train_pct=walk_forward_train_pct,
        monte_carlo=monte_carlo, monte_carlo_sims=monte_carlo_sims,
        trade_start=pd.Timestamp(start_date), benchmark=bench_close, deadline=deadline,
        symbol=ticker,
    )
    if "error" in result:
        return result
    result["benchmark_ticker"] = benchmark_ticker.upper()
    result["symbol"] = ticker.upper()
    result["data_source"] = "adjusted_daily_bars"
    result["warnings"] = warns + result.get("warnings", [])
    result["disclaimer"] = "Hypothetical results; past performance does not guarantee future results."
    return result


# ── Endpoints ──────────────────────────────────────────────────────────

@router.post("/backtest")
def run_backtest(request: BacktestRequest):
    """Backtest one named strategy on one symbol (next-bar-open fills)."""
    try:
        start_date, end_date = _parse_dates(request.start_date, request.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO format.")
    if request.strategy not in STRATEGY_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {request.strategy}")
    try:
        result = _run_single_backtest(
            db=None, ticker=request.symbol, start_date=start_date, end_date=end_date,
            strategy=request.strategy, initial_capital=request.initial_capital,
            strategy_params=request.strategy_params, position_sizing=request.position_sizing,
            commission_rate=request.commission_rate, slippage_rate=request.slippage_rate,
            stop_loss_pct=request.stop_loss_pct, take_profit_pct=request.take_profit_pct,
            trailing_stop_pct=request.trailing_stop_pct, max_pyramiding=request.max_pyramiding,
            walk_forward=request.walk_forward, walk_forward_train_pct=request.walk_forward_train_pct,
            monte_carlo=request.monte_carlo, monte_carlo_sims=request.monte_carlo_sims,
            benchmark_ticker=request.benchmark, deadline=time.monotonic() + L.RUN_TIME_BUDGET_S,
        )
    except HTTPException:
        raise
    except Exception as e:
        from app.services.backtesting.engine import BacktestTimeout
        if isinstance(e, BacktestTimeout):
            raise HTTPException(status_code=408, detail="Backtest exceeded its time budget; shorten the date range.")
        logger.exception("Backtest engine error")
        raise HTTPException(status_code=500, detail="Backtest engine error")
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/backtest/jobs", status_code=202)
def start_backtest_job(request: BacktestRequest, user_id: int = Depends(_guard_token)):
    """Same backtest as ``POST /backtest``, run as a background job so it keeps
    going when the user leaves the page. Poll ``GET /backtest/v2/jobs/{id}``;
    re-attach with ``GET /backtest/v2/jobs/latest?kind=classic``."""
    from app.services.backtesting.engine import BacktestTimeout
    from app.services.backtesting.jobs import AlreadyRunning, QueueFull, manager

    try:
        start_date, end_date = _parse_dates(request.start_date, request.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO format.")
    if request.strategy not in STRATEGY_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {request.strategy}")

    def work(progress, deadline, should_cancel):
        progress("Fetching adjusted bars and running the strategy", 0.1)
        try:
            result = _run_single_backtest(
                db=None, ticker=request.symbol, start_date=start_date, end_date=end_date,
                strategy=request.strategy, initial_capital=request.initial_capital,
                strategy_params=request.strategy_params, position_sizing=request.position_sizing,
                commission_rate=request.commission_rate, slippage_rate=request.slippage_rate,
                stop_loss_pct=request.stop_loss_pct, take_profit_pct=request.take_profit_pct,
                trailing_stop_pct=request.trailing_stop_pct, max_pyramiding=request.max_pyramiding,
                walk_forward=request.walk_forward, walk_forward_train_pct=request.walk_forward_train_pct,
                monte_carlo=request.monte_carlo, monte_carlo_sims=request.monte_carlo_sims,
                benchmark_ticker=request.benchmark,
                deadline=min(deadline, time.monotonic() + L.RUN_TIME_BUDGET_S),
            )
        except BacktestTimeout:
            raise
        if "error" in result:
            raise ValueError(result["error"])
        # Plain JSON (numpy scalars and timestamps) so the durable snapshot round-trips.
        from fastapi.encoders import jsonable_encoder

        return jsonable_encoder(result, custom_encoder={np.generic: lambda v: v.item()})

    try:
        job = manager.submit(str(user_id), work, kind="classic")
    except AlreadyRunning:
        raise HTTPException(status_code=409, detail="You already have a backtest running. Wait for it or cancel it.")
    except QueueFull:
        raise HTTPException(status_code=429, detail="The backtest queue is full. Try again in a minute.")
    return job.public(include_result=False)


@router.post("/backtest/compare")
def compare_strategies(request: CompareRequest):
    """Run several named strategies on the same symbol and data."""
    try:
        start_date, end_date = _parse_dates(request.start_date, request.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format.")

    deadline = time.monotonic() + L.JOB_TIME_BUDGET_S
    results = []
    for strat_name in request.strategies:
        if strat_name not in STRATEGY_REGISTRY:
            results.append({"strategy": strat_name, "error": f"Unknown strategy: {strat_name}"})
            continue
        try:
            r = _run_single_backtest(
                db=None, ticker=request.symbol, start_date=start_date, end_date=end_date,
                strategy=strat_name, initial_capital=request.initial_capital,
                commission_rate=request.commission_rate, slippage_rate=request.slippage_rate,
                stop_loss_pct=request.stop_loss_pct, take_profit_pct=request.take_profit_pct,
                monte_carlo=request.monte_carlo, monte_carlo_sims=500, deadline=deadline,
            )
            r["strategy"] = strat_name
            results.append(r)
        except Exception as e:
            logger.info("compare: %s failed: %s", strat_name, e)
            results.append({"strategy": strat_name, "error": "Backtest failed or ran out of time"})

    # Correlation of daily strategy returns, aligned by date.
    rets = {}
    for r in results:
        if "error" not in r and r.get("equity_curve_raw"):
            eq = pd.Series(r["equity_curve_raw"], dtype=float)
            rets[r["strategy"]] = eq.pct_change()
    correlation_matrix: Dict[str, Dict[str, float]] = {}
    if len(rets) >= 2:
        frame = pd.DataFrame(rets).dropna()
        corr = frame.corr() if len(frame) > 2 else None
        for s1 in rets:
            correlation_matrix[s1] = {}
            for s2 in rets:
                v = float(corr.loc[s1, s2]) if corr is not None and pd.notna(corr.loc[s1, s2]) else 0.0
                correlation_matrix[s1][s2] = round(v, 3)

    return {
        "symbol": request.symbol.upper(),
        "strategies": results,
        "correlation_matrix": correlation_matrix,
        "warnings": ["Picking the best of several strategies on the same history overstates its future edge."],
        "disclaimer": "Hypothetical results; past performance does not guarantee future results.",
    }


@router.post("/backtest/scan")
def scan_symbols(request: ScanRequest):
    """Run one strategy over a list of symbols and rank by Sharpe."""
    try:
        start_date, end_date = _parse_dates(request.start_date, request.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format.")
    if request.strategy not in STRATEGY_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {request.strategy}")

    deadline = time.monotonic() + L.SCAN_TIME_BUDGET_S
    results = []
    skipped = []
    timed_out = False
    for ticker in request.symbols:
        if time.monotonic() > deadline:
            timed_out = True
            skipped.append(ticker.upper())
            continue
        try:
            r = _run_single_backtest(
                db=None, ticker=ticker, start_date=start_date, end_date=end_date,
                strategy=request.strategy, initial_capital=request.initial_capital,
                strategy_params=request.strategy_params,
                monte_carlo=False, walk_forward=False, deadline=deadline,
            )
            if "error" in r:
                skipped.append(ticker.upper())
                continue
            passes = True
            if request.min_sharpe is not None and r.get("sharpe_ratio", 0) < request.min_sharpe:
                passes = False
            if request.min_win_rate is not None and r.get("win_rate", 0) < request.min_win_rate:
                passes = False
            if request.min_return is not None and r.get("total_return", 0) < request.min_return:
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
                "equity_curve": r.get("equity_curve", [])[:50],
                "passed_filters": passes,
            })
        except Exception:
            skipped.append(ticker.upper())
            continue

    results.sort(key=lambda x: x.get("sharpe_ratio", 0), reverse=True)
    return {
        "strategy": request.strategy,
        "total_scanned": len(request.symbols),
        "results_count": len(results),
        "results": results,
        "skipped": skipped,
        "timed_out": timed_out,
        "warnings": [
            "Survivorship bias: the list contains symbols that exist today; delisted companies are missing.",
            "Ranking many symbols by Sharpe picks winners by luck as well as skill; expect the top rows to do worse going forward.",
        ],
        "disclaimer": "Hypothetical results; past performance does not guarantee future results.",
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
    "CB": "Chubb Ltd", "LRCX": "Lam Research", "MRSH": "Marsh & McLennan", "ADP": "ADP Inc",
    "VRTX": "Vertex Pharma", "CME": "CME Group", "SLB": "Schlumberger", "TJX": "TJX Companies",
    "ETN": "Eaton Corp", "PLD": "Prologis Inc", "MU": "Micron Technology", "FISV": "Fiserv Inc",
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
    "ALL": "Allstate Corp", "ROST": "Ross Stores", "URI": "United Rentals",
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
    "XYZ": "Block Inc", "SHOP": "Shopify Inc", "SNAP": "Snap Inc", "UBER": "Uber Technologies",
    "LYFT": "Lyft Inc", "DASH": "DoorDash Inc", "RBLX": "Roblox Corp",
    "COIN": "Coinbase Global", "PLTR": "Palantir Technologies", "SOFI": "SoFi Technologies",
    "RIVN": "Rivian Automotive", "LCID": "Lucid Group", "MARA": "MARA Holdings",
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
    "SKYD": "Skydance Corp",
    "CAG": "Conagra Brands", "CPB": "Campbell Soup", "HRL": "Hormel Foods",
    "BBY": "Best Buy Co", "ETSY": "Etsy Inc", "W": "Wayfair Inc",
    "CHWY": "Chewy Inc", "DG": "Dollar General", "DLTR": "Dollar Tree",
    "FIVE": "Five Below", "TJX": "TJX Companies", "RVMD": "Revolution Medicines",
    "AKAM": "Akamai Technologies", "CC": "Chemours Co", "CE": "Celanese Corp",
}


@router.get("/backtest/symbols")
def search_backtest_symbols(q: str = Query("", min_length=1), limit: int = Query(12, le=30)):
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


@router.get("/backtest/date-range/{symbol}")
def get_backtest_date_range(symbol: str):
    """Return the earliest and latest dates with available price data for a symbol.
    Used by frontend to constrain date pickers to valid ranges."""
    import yfinance as yf
    ticker = symbol.strip().upper()
    try:
        tk = yf.Ticker(ticker)
        # Fetch max history to find bounds — use 1mo interval for speed
        hist = tk.history(period="max", interval="1mo")
        if hist.empty:
            # Fallback: try daily for last 5 years
            hist = tk.history(period="5y", interval="1d")
        if hist.empty:
            return {"symbol": ticker, "available": False, "error": "No data found"}

        first_date = hist.index[0]
        last_date = hist.index[-1]
        # Normalize timezone
        if hasattr(first_date, 'tz') and first_date.tz is not None:
            first_date = first_date.tz_localize(None)
            last_date = last_date.tz_localize(None)

        return {
            "symbol": ticker,
            "available": True,
            "min_date": first_date.strftime("%Y-%m-%d"),
            "max_date": last_date.strftime("%Y-%m-%d"),
            "total_bars": len(hist),
        }
    except Exception as e:
        return {"symbol": ticker, "available": False, "error": str(e)}


@router.get("/strategies")
def get_strategies():
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
