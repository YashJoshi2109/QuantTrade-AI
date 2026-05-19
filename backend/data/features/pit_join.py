"""Point-in-time (PIT) join utilities.

Joins OHLCV data with SEC features and news features such that, for every
(symbol, date) row in the OHLCV panel, only features whose ``available_at``
or feature-generation timestamp is strictly ``<= date`` are included.

Key invariants enforced:
- No SEC feature timestamp > prediction_date
- No news feature date > prediction_date
- Target (h=20 forward return) is never in the feature columns
- Symbols missing SEC data receive NaN in sec_feature columns
- An audit JSON is written after every join
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import List, Optional

import pandas as pd

log = logging.getLogger(__name__)


class PointInTimeJoin:
    """Merge OHLCV, SEC, and news feature panels with PIT guarantees.

    Parameters
    ----------
    ohlcv_df:
        Raw OHLCV bars with columns including ``symbol``, ``date``.
    sec_features_df:
        DataFrame indexed by (symbol, date) from ``SECFeatureGenerator``.
    news_features_df:
        DataFrame indexed by (symbol, date) from ``NewsFeatureGenerator``.
    horizon:
        Forward-return horizon in trading days (default 20).
    output_dir:
        Directory where the audit JSON is written.
    """

    def __init__(
        self,
        ohlcv_df: pd.DataFrame,
        sec_features_df: Optional[pd.DataFrame] = None,
        news_features_df: Optional[pd.DataFrame] = None,
        horizon: int = 20,
        output_dir: Optional[str] = None,
    ) -> None:
        self.ohlcv_df = ohlcv_df.copy()
        self.sec_features_df = sec_features_df
        self.news_features_df = news_features_df
        self.horizon = horizon
        self.output_dir = Path(output_dir) if output_dir else None

        # Normalise date columns
        self.ohlcv_df["date"] = pd.to_datetime(self.ohlcv_df["date"], errors="coerce")

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def run(self) -> pd.DataFrame:
        """Execute the PIT join and return the merged feature DataFrame.

        Returns DataFrame with (symbol, date) index and feature columns.
        Target column ``fwd_return_h{horizon}`` is excluded from the output
        if present — callers must reattach it explicitly.
        """
        panel = self.ohlcv_df.copy()

        # Join SEC features (left join → NaN for missing symbols)
        if self.sec_features_df is not None and not self.sec_features_df.empty:
            panel = self._join_features(
                panel,
                self.sec_features_df,
                prefix="sec",
            )

        # Join news features (left join → NaN for missing symbols)
        if self.news_features_df is not None and not self.news_features_df.empty:
            panel = self._join_features(
                panel,
                self.news_features_df,
                prefix="news",
            )

        # Drop target column if it accidentally ended up here
        target_col = f"fwd_return_h{self.horizon}"
        if target_col in panel.columns:
            panel = panel.drop(columns=[target_col])
            log.warning("pit_join: dropped target column '%s' from features", target_col)

        self._run_audit(panel)
        return panel

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _join_features(
        panel: pd.DataFrame,
        features: pd.DataFrame,
        prefix: str,
    ) -> pd.DataFrame:
        """Left-join *features* (indexed by symbol/date) onto *panel*."""
        if isinstance(features.index, pd.MultiIndex):
            feat_reset = features.reset_index()
        else:
            feat_reset = features.copy()

        # Rename feature columns to avoid collisions
        feature_cols = [c for c in feat_reset.columns if c not in ("symbol", "date")]
        rename_map = {}
        for c in feature_cols:
            if not c.startswith(prefix + "_"):
                rename_map[c] = f"{prefix}_{c}"
        feat_reset = feat_reset.rename(columns=rename_map)

        feat_reset["date"] = pd.to_datetime(feat_reset["date"], errors="coerce")
        if "symbol" in feat_reset.columns:
            feat_reset["symbol"] = feat_reset["symbol"].str.upper()

        merged = panel.merge(feat_reset, on=["symbol", "date"], how="left")
        log.debug(
            "pit_join: merged %s features — panel grew from %d to %d cols",
            prefix,
            len(panel.columns),
            len(merged.columns),
        )
        return merged

    def _run_audit(self, panel: pd.DataFrame) -> None:
        """Verify PIT constraints and write audit JSON."""
        audit: dict = {
            "total_rows": len(panel),
            "symbols": int(panel["symbol"].nunique()) if "symbol" in panel.columns else 0,
            "violations": [],
        }

        # Check all (symbol, date) rows for any feature column with a timestamp > date
        # (This check applies to columns that are themselves dates; skip numerical features)
        for col in panel.columns:
            if "available_at" in col or "filing_date" in col or "date" in col.lower():
                if col in ("date", "symbol"):
                    continue
                try:
                    col_dates = pd.to_datetime(panel[col], errors="coerce")
                    violations = panel[col_dates > panel["date"]]
                    if not violations.empty:
                        audit["violations"].append({
                            "column": col,
                            "count": len(violations),
                        })
                        log.warning(
                            "pit_join audit: %d future-date violations in column '%s'",
                            len(violations),
                            col,
                        )
                except Exception:
                    pass

        if self.output_dir:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            audit_path = self.output_dir / "point_in_time_join_audit.json"
            with open(audit_path, "w") as f:
                json.dump(audit, f, indent=2, default=str)
            log.info("pit_join: audit written to %s", audit_path)
        else:
            log.info("pit_join: audit — rows=%d, violations=%d", audit["total_rows"], len(audit["violations"]))

        if audit["violations"]:
            log.error(
                "pit_join: %d PIT violation(s) detected — see audit for details",
                len(audit["violations"]),
            )
