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
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA",
    "META", "TSLA", "JPM", "V", "JNJ",
]

TIER_2_SYMBOLS: list[str] = [
    # Tech
    "AMD", "INTC", "CRM", "ADBE", "ORCL", "CSCO", "AVGO", "QCOM", "TXN", "NOW",
    "SNOW", "DDOG", "NET", "SHOP", "SQ", "UBER", "ABNB", "COIN", "PLTR", "PANW",
    # Healthcare
    "UNH", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR", "BMY", "AMGN",
    # Finance
    "BAC", "WFC", "GS", "MS", "BLK", "SCHW", "C", "AXP", "MA",
    # Consumer
    "WMT", "HD", "PG", "KO", "PEP", "COST", "MCD", "NKE", "DIS", "NFLX",
    # Energy
    "XOM", "CVX",
]

TIER_3_SYMBOLS: list[str] = [
    "PYPL", "IBM", "DELL", "HPE", "MRVL", "ARM", "SMCI", "CRWD", "ZS", "FTNT",
    "OKTA", "MDB", "TEAM", "WDAY", "VEEV", "HUBS", "TTD", "U", "PATH", "NTNX",
    "BA", "GE", "CAT", "HON", "UPS", "RTX", "LMT", "DE", "MMM", "FDX",
    "CEG", "VST", "NEE", "DUK", "SO", "AEP", "D", "SRE", "EXC", "XEL",
    "TJX", "ETSY", "W", "CHWY", "DG", "DLTR", "FIVE", "BBY", "RVMD",
    "T", "VZ", "TMUS", "CMCSA",
    "BRK-B", "SPY", "QQQ", "IWM", "DIA",
]

ALL_SYMBOLS: list[str] = sorted(set(TIER_1_SYMBOLS + TIER_2_SYMBOLS + TIER_3_SYMBOLS))

SYMBOL_TIERS: dict[str, list[str]] = {
    "tier_1": TIER_1_SYMBOLS,
    "tier_2": TIER_1_SYMBOLS + TIER_2_SYMBOLS,
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
