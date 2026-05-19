"""SEC filing feature generator.

All features are computed point-in-time: for date ``d``, only filings
with ``available_at <= d`` are used.  Missing features are NaN (not 0),
so downstream models can distinguish "no filing available" from zero.

Text processing uses the standard library only (``re``, ``collections``).
LM word lists are simplified frozensets; no NLTK required.
"""
from __future__ import annotations

import json
import logging
import math
import re
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Loughran-McDonald simplified word lists
# ---------------------------------------------------------------------------

LM_NEGATIVE_WORDS: frozenset = frozenset([
    "loss", "losses", "decline", "declines", "decrease", "decreases",
    "impairment", "impairments", "adverse", "adversely", "unfavorable",
    "deficit", "defaulted", "default", "downgrade", "downgrades",
    "deterioration", "deteriorates", "risk", "risks", "uncertainty",
    "uncertain", "volatile", "volatility", "litigation", "lawsuit",
    "investigation", "penalty", "penalties", "breach", "breaches",
])

LM_POSITIVE_WORDS: frozenset = frozenset([
    "growth", "increase", "improvement", "improved", "gain", "gains",
    "strength", "strong", "profit", "profitable", "profitability",
    "revenue", "revenues", "success", "successful", "achieve", "achieved",
    "exceed", "exceeded", "record", "expand", "expansion", "progress",
])

LM_UNCERTAINTY_WORDS: frozenset = frozenset([
    "uncertain", "uncertainty", "unclear", "unknown", "unpredictable",
    "contingent", "contingency", "approximate", "approximately",
    "estimate", "estimated", "may", "might", "could",
    "possibly", "possible", "likelihood", "likely",
])

LM_LITIGATION_WORDS: frozenset = frozenset([
    "litigation", "lawsuit", "lawsuits", "plaintiff", "defendant",
    "settlement", "settlements", "court", "indictment", "subpoena",
    "arbitration", "class action", "civil action",
])

# ---------------------------------------------------------------------------
# Regex patterns for section extraction
# ---------------------------------------------------------------------------

_RISK_PATTERN = re.compile(
    r"(?i)(?:item\s+1a\.?\s*)?(?:risk\s+factors?)(.*?)(?=item\s+\d|$)",
    re.DOTALL,
)
_MDNA_PATTERN = re.compile(
    r"(?i)(?:item\s+7\.?\s*)?(?:management.{0,30}discussion\s+and\s+analysis)(.*?)(?=item\s+\d|$)",
    re.DOTALL,
)


class SECFeatureGenerator:
    """Generate point-in-time SEC filing features for (symbol, date) pairs.

    Parameters
    ----------
    filings_df:
        Output of ``SECIngestion.get_filings_dataframe()``.  Must have
        columns: symbol, cik, accessionNumber, form, available_at.
    filing_texts:
        Mapping of ``{accessionNumber: text}`` for downloaded filings.
    """

    def __init__(
        self,
        filings_df: pd.DataFrame,
        filing_texts: Optional[Dict[str, str]] = None,
    ) -> None:
        self.filings_df = filings_df.copy()
        self.filing_texts = filing_texts or {}

        # Ensure available_at is datetime
        if "available_at" in self.filings_df.columns:
            self.filings_df["available_at"] = pd.to_datetime(
                self.filings_df["available_at"], errors="coerce"
            )

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def build_daily_features(
        self,
        symbols: List[str],
        dates: pd.DatetimeIndex,
    ) -> pd.DataFrame:
        """Build PIT features for every (symbol, date) combination.

        For date ``d``, only filings with ``available_at <= d`` are used.
        Missing features are NaN (not 0).
        """
        records = []
        for sym in symbols:
            sym_filings = self.filings_df[
                self.filings_df["symbol"].str.upper() == sym.upper()
            ].copy()

            for d in dates:
                row = self._compute_features_for_date(sym, sym_filings, d)
                row["symbol"] = sym.upper()
                row["date"] = d
                records.append(row)

        if not records:
            return pd.DataFrame()

        df = pd.DataFrame(records).set_index(["symbol", "date"])
        return df

    # ------------------------------------------------------------------
    # Per-date feature computation
    # ------------------------------------------------------------------

    def _compute_features_for_date(
        self,
        symbol: str,
        sym_filings: pd.DataFrame,
        d: pd.Timestamp,
    ) -> dict:
        """Compute all features for (symbol, d) using only available_at <= d."""
        feat: dict = {}
        nan = float("nan")

        # PIT filter: only filings known by date d
        pit = sym_filings[sym_filings["available_at"] <= d]

        if pit.empty:
            # No filings available yet — all features are NaN
            return {k: nan for k in self._feature_names()}

        # --- filing recency
        for form in ["10-K", "10-Q", "8-K"]:
            form_key = form.replace("-", "").lower()
            sub = pit[pit["form"] == form]
            if sub.empty:
                feat[f"days_since_{form_key}"] = nan
                feat[f"latest_{form_key}_age_days"] = nan
            else:
                most_recent = sub["available_at"].max()
                age = (d - most_recent).days
                feat[f"days_since_{form_key}"] = float(age)
                feat[f"latest_{form_key}_age_days"] = float(age)

        # --- filing count windows
        for window in [30, 90]:
            window_start = d - pd.Timedelta(days=window)
            count = ((pit["available_at"] > window_start) & (pit["available_at"] <= d)).sum()
            feat[f"filings_count_{window}d"] = float(count)

        # --- text-based features from most recent 10-K or 10-Q
        text_feats = self._text_features_pit(pit, d)
        feat.update(text_feats)

        return feat

    def _text_features_pit(self, pit: pd.DataFrame, d: pd.Timestamp) -> dict:
        """Compute text-based features from the most recent 10-K or 10-Q filing."""
        nan = float("nan")
        text_feats: dict = {
            "filing_text_length": nan,
            "filing_text_length_change": nan,
            "risk_factor_text_length": nan,
            "mdna_text_length": nan,
            "risk_factor_similarity_change": nan,
            "mdna_similarity_change": nan,
            "negative_word_ratio": nan,
            "uncertainty_word_ratio": nan,
            "litigation_word_ratio": nan,
            "filing_sentiment_score": nan,
        }

        substance_forms = pit[pit["form"].isin(["10-K", "10-Q"])].sort_values("available_at")
        if substance_forms.empty:
            return text_feats

        latest_row = substance_forms.iloc[-1]
        latest_acc = latest_row.get("accessionNumber", "")
        latest_text = self.filing_texts.get(latest_acc, "")

        if not latest_text:
            return text_feats

        text_feats["filing_text_length"] = float(len(latest_text))

        # Prior filing text for change features
        if len(substance_forms) >= 2:
            prior_acc = substance_forms.iloc[-2].get("accessionNumber", "")
            prior_text = self.filing_texts.get(prior_acc, "")
            if prior_text:
                text_feats["filing_text_length_change"] = float(
                    len(latest_text) - len(prior_text)
                )

        # Section extraction
        risk_text = self.extract_section(latest_text, "risk_factors")
        mdna_text = self.extract_section(latest_text, "mdna")
        text_feats["risk_factor_text_length"] = float(len(risk_text))
        text_feats["mdna_text_length"] = float(len(mdna_text))

        # Section similarity change vs prior
        if len(substance_forms) >= 2:
            prior_acc = substance_forms.iloc[-2].get("accessionNumber", "")
            prior_text = self.filing_texts.get(prior_acc, "")
            if prior_text:
                prior_risk = self.extract_section(prior_text, "risk_factors")
                prior_mdna = self.extract_section(prior_text, "mdna")
                if risk_text and prior_risk:
                    text_feats["risk_factor_similarity_change"] = float(
                        self._tfidf_cosine(risk_text, prior_risk)
                    )
                if mdna_text and prior_mdna:
                    text_feats["mdna_similarity_change"] = float(
                        self._tfidf_cosine(mdna_text, prior_mdna)
                    )

        # LM sentiment
        sentiment = self.compute_text_sentiment(latest_text)
        text_feats.update(sentiment)

        return text_feats

    # ------------------------------------------------------------------
    # Text utilities
    # ------------------------------------------------------------------

    def extract_section(self, text: str, section: str) -> str:
        """Extract Risk Factors or MD&A section from filing text."""
        if not text:
            return ""
        if section == "risk_factors":
            m = _RISK_PATTERN.search(text)
        elif section == "mdna":
            m = _MDNA_PATTERN.search(text)
        else:
            return ""
        if m:
            extracted = m.group(1).strip()
            # Cap to first 50 000 chars to avoid memory blow-up
            return extracted[:50_000]
        return ""

    def compute_text_sentiment(self, text: str) -> dict:
        """Return LM sentiment ratios from raw filing text."""
        if not text:
            return {
                "negative_word_ratio": float("nan"),
                "uncertainty_word_ratio": float("nan"),
                "litigation_word_ratio": float("nan"),
                "filing_sentiment_score": float("nan"),
            }
        # Simple word tokenisation: lowercase, strip punctuation
        words = re.findall(r"[a-z]+", text.lower())
        total = len(words)
        if total == 0:
            return {
                "negative_word_ratio": 0.0,
                "uncertainty_word_ratio": 0.0,
                "litigation_word_ratio": 0.0,
                "filing_sentiment_score": 0.0,
            }
        counter = Counter(words)
        neg_count = sum(counter[w] for w in LM_NEGATIVE_WORDS if w in counter)
        pos_count = sum(counter[w] for w in LM_POSITIVE_WORDS if w in counter)
        unc_count = sum(counter[w] for w in LM_UNCERTAINTY_WORDS if w in counter)
        lit_count = sum(counter[w] for w in LM_LITIGATION_WORDS if w in counter)

        return {
            "negative_word_ratio": neg_count / total,
            "uncertainty_word_ratio": unc_count / total,
            "litigation_word_ratio": lit_count / total,
            "filing_sentiment_score": (pos_count - neg_count) / total,
        }

    @staticmethod
    def _tfidf_cosine(text_a: str, text_b: str) -> float:
        """Compute TF-IDF cosine similarity between two texts (stdlib only)."""
        def _tokenise(t: str) -> List[str]:
            return re.findall(r"[a-z]+", t.lower())

        def _tf(words: List[str]) -> Dict[str, float]:
            c = Counter(words)
            total = max(len(words), 1)
            return {w: cnt / total for w, cnt in c.items()}

        words_a = _tokenise(text_a)
        words_b = _tokenise(text_b)
        if not words_a or not words_b:
            return 0.0

        vocab = set(words_a) | set(words_b)
        # Simplified: use raw TF (IDF is proportional to log(2/df) for 2-doc corpus)
        tf_a = _tf(words_a)
        tf_b = _tf(words_b)

        dot = sum(tf_a.get(w, 0.0) * tf_b.get(w, 0.0) for w in vocab)
        norm_a = math.sqrt(sum(v ** 2 for v in tf_a.values()))
        norm_b = math.sqrt(sum(v ** 2 for v in tf_b.values()))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    # ------------------------------------------------------------------
    # Coverage report
    # ------------------------------------------------------------------

    def save_coverage_report(
        self,
        features_df: pd.DataFrame,
        output_dir: str,
    ) -> None:
        """Save ``sec_feature_coverage.json`` and ``sec_feature_matrix_sample.csv``."""
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        total_cells = features_df.size
        non_null = features_df.notna().sum().sum()
        coverage_pct = (non_null / total_cells * 100) if total_cells > 0 else 0.0

        per_feature = features_df.notna().mean().to_dict()
        report = {
            "total_cells": int(total_cells),
            "non_null_cells": int(non_null),
            "coverage_pct": round(float(coverage_pct), 2),
            "per_feature_coverage": {k: round(float(v), 4) for k, v in per_feature.items()},
        }
        with open(out / "sec_feature_coverage.json", "w") as f:
            json.dump(report, f, indent=2)

        sample = features_df.head(100)
        sample.to_csv(out / "sec_feature_matrix_sample.csv")
        log.info("sec features: coverage report written to %s", out)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _feature_names() -> List[str]:
        return [
            "days_since_10k", "latest_10k_age_days",
            "days_since_10q", "latest_10q_age_days",
            "days_since_8k", "latest_8k_age_days",
            "filings_count_30d", "filings_count_90d",
            "filing_text_length", "filing_text_length_change",
            "risk_factor_text_length", "mdna_text_length",
            "risk_factor_similarity_change", "mdna_similarity_change",
            "negative_word_ratio", "uncertainty_word_ratio",
            "litigation_word_ratio", "filing_sentiment_score",
        ]
