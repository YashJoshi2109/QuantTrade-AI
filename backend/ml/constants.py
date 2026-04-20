"""Shared constants for ML training and inference.

Single source of truth for feature columns, symbol tiers, and paths.
Never import from app.* here — this module must be standalone.
"""

from pathlib import Path

# ── Feature columns (ordered, immutable at training time) ──────────────

FEATURE_COLUMNS: list[str] = [
    # Price
    "Close",
    "Volume",
    # Trend
    "SMA_20",
    "SMA_50",
    "EMA_9",
    "EMA_21",
    # Momentum
    "RSI_14",
    "MACD",
    "MACD_Signal",
    "MACD_Histogram",
    "ROC_10",
    # Volatility
    "BB_Upper",
    "BB_Lower",
    "ATR_14",
    "Drawdown",
    # Volume
    "Volume_SMA_20",
    "Volume_Change",
    # Context
    "Log_Return",
    "Distance_52w_High",
    "Returns_vs_SPY",
]

NUM_FEATURES = len(FEATURE_COLUMNS)  # 20

# ── Symbol tiers ───────────────────────────────────────────────────────

TIER_1_SYMBOLS: list[str] = [
    # Mega-caps (top 20 by market cap) — always trained first
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B",
    "JPM", "V", "UNH", "JNJ", "XOM", "MA", "PG", "HD", "AVGO", "MRK",
    "COST", "LLY",
]

TIER_2_SYMBOLS: list[str] = [
    # Large-cap tech
    "AMD", "INTC", "CRM", "ADBE", "ORCL", "CSCO", "QCOM", "TXN", "NOW", "AMAT",
    "LRCX", "KLAC", "MRVL", "SNPS", "CDNS", "FTNT", "PANW", "CRWD", "ZS", "NET",
    "DDOG", "SNOW", "MDB", "SHOP", "SQ", "COIN", "PLTR", "ARM", "SMCI", "DELL",
    # Finance
    "BAC", "WFC", "GS", "MS", "BLK", "SCHW", "C", "AXP", "ICE", "CME",
    "MCO", "MSCI", "SPGI", "CB", "AON", "MMC", "PGR", "TRV", "MET", "AIG",
    # Healthcare
    "PFE", "ABBV", "TMO", "ABT", "DHR", "BMY", "AMGN", "GILD", "VRTX", "REGN",
    "ISRG", "MDT", "SYK", "BDX", "EW", "ZTS", "IDXX", "DXCM", "ALGN", "BSX",
    # Consumer
    "WMT", "KO", "PEP", "MCD", "NKE", "DIS", "NFLX", "SBUX", "TJX", "LOW",
    "TGT", "ROST", "ORLY", "AZO", "CMG", "YUM", "DPZ", "MNST", "KHC", "CL",
    # Industrials
    "BA", "GE", "CAT", "HON", "UPS", "RTX", "LMT", "DE", "MMM", "FDX",
    "GD", "NOC", "WM", "RSG", "EMR", "ITW", "PH", "ROK", "ETN", "IR",
    # Energy
    "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO", "OXY", "DVN", "HAL",
    # Utilities + REITs
    "NEE", "DUK", "SO", "AEP", "D", "SRE", "EXC", "XEL", "CEG", "VST",
    "PLD", "AMT", "EQIX", "CCI", "PSA", "SPG", "O", "WELL", "DLR", "AVB",
    # Telecom + Media
    "T", "VZ", "TMUS", "CMCSA", "CHTR", "WBD", "PARA", "FOX",
    # Materials
    "LIN", "APD", "SHW", "ECL", "DD", "NEM", "FCX", "NUE", "STLD", "CF",
]

TIER_3_SYMBOLS: list[str] = [
    # Growth / Mid-cap tech
    "UBER", "ABNB", "DASH", "TTD", "TEAM", "WDAY", "VEEV", "HUBS", "OKTA", "PATH",
    "U", "NTNX", "ESTC", "CFLT", "BILL", "PCOR", "MNDY", "ZI", "GTLB", "IOT",
    # Semiconductors
    "ON", "SWKS", "QRVO", "MPWR", "WOLF", "ACLS", "ENTG", "ONTO",
    # Consumer discretionary
    "ETSY", "W", "CHWY", "DG", "DLTR", "FIVE", "BBY", "TSCO", "ULTA", "DECK",
    "LULU", "BIRD", "RH", "WSM", "GRMN", "HAS", "MAT",
    # Biotech / Pharma
    "MRNA", "BIIB", "IQV", "CNC", "CI", "HUM", "MOH", "ELV", "HCA", "DVA",
    # Fintech
    "PYPL", "FIS", "FISV", "GPN", "WEX", "NDAQ", "CBOE",
    # Other
    "RIVN", "LCID", "PLUG", "FSLR", "ENPH", "SEDG",
    "HPE", "IBM", "HPQ", "EPAM", "GLOB",
    # Additional mid-caps to reach ~300
    "CTAS", "ODFL", "FAST", "PAYX", "VRSK", "CPRT", "FICO", "ANSS", "CDW", "BR",
    "TRGP", "WMB", "KMI", "OKE", "ET", "CTRA", "FANG", "APA", "MRO", "AR",
    "WAB", "CARR", "TT", "DOV", "HUBB", "NDSN", "ALLE", "SWK",
    "VICI", "IRM", "SBAC", "ESS", "MAA", "UDR", "KIM", "REG", "HST", "CPT",
    # ETF benchmarks
    "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK", "XLV", "XLI", "XLP",
]

ALL_SYMBOLS: list[str] = sorted(set(TIER_1_SYMBOLS + TIER_2_SYMBOLS + TIER_3_SYMBOLS))

SYMBOL_TIERS: dict[str, list[str]] = {
    "tier_1": TIER_1_SYMBOLS,
    "tier_2": TIER_1_SYMBOLS + TIER_2_SYMBOLS,
    "tier_3": TIER_1_SYMBOLS + TIER_2_SYMBOLS + TIER_3_SYMBOLS,
    "all": ALL_SYMBOLS,
}

# ── Paths ──────────────────────────────────────────────────────────────

ML_ROOT = Path(__file__).parent
DEFAULT_CHECKPOINT_DIR = ML_ROOT / "checkpoints"
DEFAULT_CACHE_DIR = ML_ROOT / "data_cache"
DEFAULT_CONFIG_PATH = ML_ROOT.parent / "configs" / "train_default.yaml"

# ── Model defaults ─────────────────────────────────────────────────────

DEFAULT_SEQ_LEN = 60
DEFAULT_HIDDEN_SIZE = 128
DEFAULT_NUM_LAYERS = 3
DEFAULT_DROPOUT = 0.2
DEFAULT_HORIZONS = [1, 7, 30]
