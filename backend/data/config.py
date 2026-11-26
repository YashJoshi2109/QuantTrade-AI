"""Free-data branch config — all milestones."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


@dataclass
class FreeDataConfig:
    # Providers enabled
    use_stooq: bool = True
    use_yfinance: bool = True       # fallback if stooq fails
    use_sec_edgar: bool = True
    use_gdelt: bool = True
    use_finnhub: bool = False       # optional paid-free tier

    # Paths
    raw_ohlcv_stooq: str = str(BASE_DIR / "data/raw/ohlcv/stooq")
    raw_ohlcv_yfinance: str = str(BASE_DIR / "data/raw/ohlcv/yfinance")
    raw_sec_submissions: str = str(BASE_DIR / "data/raw/sec/submissions")
    raw_sec_companyfacts: str = str(BASE_DIR / "data/raw/sec/companyfacts")
    raw_sec_filings: str = str(BASE_DIR / "data/raw/sec/filings")
    raw_news_gdelt: str = str(BASE_DIR / "data/raw/news/gdelt")
    processed_parquet: str = str(BASE_DIR / "data/processed/parquet")

    # OHLCV
    ohlcv_symbols: list = field(default_factory=list)
    ohlcv_start_date: str = "2018-01-01"
    ohlcv_end_date: str = ""  # empty = today

    # OHLCV per-provider timeouts
    ohlcv_stooq_timeout: float = 5.0       # connect+read timeout per Stooq request
    ohlcv_yfinance_timeout: float = 60.0   # per yfinance.download call
    ohlcv_symbol_timeout: float = 90.0     # total hard limit per symbol (all providers)

    # SEC
    sec_user_agent: str = "QuantTradeAI research@example.com"
    sec_forms: list = field(default_factory=lambda: ["10-K", "10-Q", "8-K"])
    sec_rate_limit_delay: float = 0.12  # ~8 req/s (SEC allows 10)
    sec_max_retries: int = 5
    sec_request_timeout: float = 30.0   # per-request read timeout

    # GDELT
    gdelt_lookback_days: int = 365 * 3
    gdelt_max_articles_per_symbol: int = 10000
    gdelt_request_timeout: float = 30.0  # per GDELT API request timeout

    # Features
    news_lookback_days: list = field(default_factory=lambda: [1, 7, 30])
    sec_feature_lookback_days: list = field(default_factory=lambda: [30, 90])

    # RAG
    rag_chunk_size: int = 1000
    rag_chunk_overlap: int = 200
    rag_embedding_model: str = "all-MiniLM-L6-v2"
    rag_embedding_dim: int = 384

    # h=20 experiment
    horizon: int = 20
    wf_train_days: int = 756
    wf_test_days: int = 63
    wf_retrain_every: int = 63
    top_k_long: int = 20
    transaction_cost_bps: float = 10.0
    slippage_bps: float = 5.0
    promo_min_ic: float = 0.03
    promo_min_ic_hit_rate: float = 0.55

    @classmethod
    def from_yaml(cls, path) -> "FreeDataConfig":
        import yaml
        from pathlib import Path as _Path
        p = _Path(path)
        if not p.exists():
            raise FileNotFoundError(f"Config not found: {p}")
        with open(p) as f:
            raw = yaml.safe_load(f) or {}
        known = {fname for fname in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in raw.items() if k in known})
