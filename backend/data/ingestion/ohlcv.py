"""OHLCV ingestion orchestrator.

Fetches daily bars from configured providers (Stooq → yfinance fallback),
runs quality checks, saves partitioned Parquet, and writes a JSON report.
"""
from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from data.config import FreeDataConfig

log = logging.getLogger(__name__)

_OHLCV_COLS = ["symbol", "date", "open", "high", "low", "close", "volume", "source"]

# Quality-check thresholds
_Z_SCORE_VOL_THRESHOLD = 10.0
_SPLIT_JUMP_THRESHOLD = 0.40        # 40 % daily return signals a split
_STALE_DAYS = 30                    # last bar more than 30 calendar days ago
_MIN_BARS = 252                     # minimum bar count for sufficient history


class OHLCVIngestion:
    """Fetch, validate, and persist OHLCV data for a list of symbols."""

    def __init__(self, config: FreeDataConfig) -> None:
        self.config = config
        self.providers = self._build_providers()

    # ------------------------------------------------------------------
    # Provider construction
    # ------------------------------------------------------------------

    def _build_providers(self) -> list:
        from data.providers.ohlcv.stooq import StooqProvider
        from data.providers.ohlcv.yfinance_provider import YFinanceProvider

        providers: list = []
        if self.config.use_stooq:
            providers.append(StooqProvider(
                raw_dir=self.config.raw_ohlcv_stooq,
                timeout=getattr(self.config, "ohlcv_stooq_timeout", 5.0),
            ))
        if self.config.use_yfinance:
            providers.append(YFinanceProvider(raw_dir=self.config.raw_ohlcv_yfinance))
        return providers

    # ------------------------------------------------------------------
    # Fetch
    # ------------------------------------------------------------------

    def fetch_symbol(self, symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
        """Try providers in order; return first non-empty result.

        Enforces ``config.ohlcv_symbol_timeout`` total seconds per symbol so
        a single hung provider (e.g. pandas_datareader, slow DNS) can't stall
        the entire batch.
        """
        timeout = getattr(self.config, "ohlcv_symbol_timeout", 90.0)

        def _try_providers() -> pd.DataFrame:
            for provider in self.providers:
                try:
                    df = provider.fetch_daily_bars(symbol, start_date, end_date)
                    if df is not None and not df.empty:
                        log.info("ohlcv %s: fetched %d bars via %s", symbol, len(df), provider.name)
                        return df
                except Exception as e:
                    log.warning("ohlcv %s: provider %s failed — %s", symbol, provider.name, e)
            log.error("ohlcv %s: all providers failed", symbol)
            return pd.DataFrame()

        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_try_providers)
            try:
                return fut.result(timeout=timeout)
            except FuturesTimeoutError:
                log.error("ohlcv %s: symbol timeout (%.0fs) exceeded — skipping", symbol, timeout)
                return pd.DataFrame()
            except Exception as e:
                log.error("ohlcv %s: unexpected error — %s", symbol, e)
                return pd.DataFrame()

    def fetch_batch(
        self,
        symbols: List[str],
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Fetch all symbols, log failures, concatenate into single DataFrame."""
        frames: list[pd.DataFrame] = []
        for sym in symbols:
            df = self.fetch_symbol(sym, start_date, end_date)
            if df.empty:
                log.warning("ohlcv batch: no data for %s", sym)
            else:
                frames.append(df)
        if not frames:
            return pd.DataFrame(columns=_OHLCV_COLS)
        return pd.concat(frames, ignore_index=True)

    # ------------------------------------------------------------------
    # Quality checks
    # ------------------------------------------------------------------

    def run_quality_checks(self, df: pd.DataFrame) -> dict:
        """Run all quality checks; return a report dict."""
        report: dict = {
            "total_rows": len(df),
            "symbols_checked": int(df["symbol"].nunique()) if "symbol" in df.columns else 0,
            "missing_dates": {},
            "duplicate_bars": [],
            "zero_negative_prices": [],
            "abnormal_volume": [],
            "split_like_jumps": [],
            "stale_symbols": [],
            "insufficient_history": [],
        }

        if df.empty:
            return report

        # --- duplicate (symbol, date) bars
        dup_mask = df.duplicated(subset=["symbol", "date"], keep=False)
        if dup_mask.any():
            dups = df[dup_mask][["symbol", "date"]].drop_duplicates()
            report["duplicate_bars"] = dups.to_dict(orient="records")
            log.warning("ohlcv quality: %d duplicate (symbol, date) pairs", len(report["duplicate_bars"]))

        # --- zero or negative prices
        price_cols = ["open", "high", "low", "close"]
        available_price_cols = [c for c in price_cols if c in df.columns]
        for col in available_price_cols:
            bad = df[df[col] <= 0][["symbol", "date", col]]
            if not bad.empty:
                report["zero_negative_prices"].extend(bad.to_dict(orient="records"))
        if report["zero_negative_prices"]:
            log.warning("ohlcv quality: %d zero/negative price rows", len(report["zero_negative_prices"]))

        # --- per-symbol checks
        now = pd.Timestamp.now()
        for sym, grp in df.groupby("symbol"):
            grp = grp.sort_values("date")

            # missing business-day dates
            if len(grp) >= 2:
                bday_range = pd.bdate_range(grp["date"].min(), grp["date"].max())
                present = set(grp["date"].dt.normalize())
                missing = [str(d.date()) for d in bday_range if d not in present]
                if missing:
                    report["missing_dates"][sym] = missing

            # abnormal volume (z-score > threshold)
            if "volume" in grp.columns and grp["volume"].std() > 0:
                vol_mean = grp["volume"].mean()
                vol_std = grp["volume"].std()
                z = (grp["volume"] - vol_mean) / vol_std
                bad_vol = grp[z.abs() > _Z_SCORE_VOL_THRESHOLD][["symbol", "date", "volume"]]
                if not bad_vol.empty:
                    report["abnormal_volume"].extend(bad_vol.to_dict(orient="records"))

            # split-like daily return jumps
            if "close" in grp.columns:
                ret = grp["close"].pct_change().abs()
                jump_rows = grp[ret > _SPLIT_JUMP_THRESHOLD][["symbol", "date", "close"]]
                if not jump_rows.empty:
                    report["split_like_jumps"].extend(jump_rows.to_dict(orient="records"))

            # stale symbols (last bar > 30 calendar days ago)
            last_bar = grp["date"].max()
            if (now - last_bar).days > _STALE_DAYS:
                report["stale_symbols"].append({
                    "symbol": sym,
                    "last_bar": str(last_bar.date()),
                    "days_stale": int((now - last_bar).days),
                })

            # insufficient history
            if len(grp) < _MIN_BARS:
                report["insufficient_history"].append({
                    "symbol": sym,
                    "bars": len(grp),
                    "minimum": _MIN_BARS,
                })

        log.info(
            "ohlcv quality: %d symbols, %d missing-date symbols, %d stale, %d insufficient",
            report["symbols_checked"],
            len(report["missing_dates"]),
            len(report["stale_symbols"]),
            len(report["insufficient_history"]),
        )
        return report

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save_parquet(self, df: pd.DataFrame) -> None:
        """Save DataFrame partitioned by symbol and year to processed_parquet dir."""
        if df.empty:
            log.warning("ohlcv save_parquet: empty DataFrame, nothing to save")
            return

        base = Path(self.config.processed_parquet)
        for (sym, yr), grp in df.assign(year=df["date"].dt.year).groupby(["symbol", "year"]):
            out_dir = base / f"symbol={sym}" / f"year={yr}"
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / "data.parquet"
            grp.drop(columns=["year"]).to_parquet(out_path, index=False)
            log.debug("ohlcv: saved %s/%d → %s (%d rows)", sym, yr, out_path, len(grp))

    # ------------------------------------------------------------------
    # Full pipeline
    # ------------------------------------------------------------------

    def run(
        self,
        symbols: List[str],
        start_date: str,
        end_date: str,
    ) -> dict:
        """Full pipeline: fetch → quality_check → save_parquet → return summary."""
        log.info("ohlcv run: fetching %d symbols [%s → %s]", len(symbols), start_date, end_date)
        df = self.fetch_batch(symbols, start_date, end_date)

        report = self.run_quality_checks(df)
        report["fetched_symbols"] = int(df["symbol"].nunique()) if not df.empty else 0
        report["total_rows"] = len(df)

        self.save_parquet(df)

        # Write quality report JSON
        report_dir = Path(self.config.processed_parquet)
        report_dir.mkdir(parents=True, exist_ok=True)
        report_path = report_dir / "ohlcv_data_quality_report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2, default=str)
        log.info("ohlcv run: quality report written to %s", report_path)

        return report
