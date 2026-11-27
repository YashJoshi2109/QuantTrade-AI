"""Typed facts for the copilot.

Every fact the model may cite carries a stable ``id`` (what the answer cites as
``[id]``), a ``source`` (where the number came from) and an ``as_of``.  Ids are
deterministic so citations survive caching and can be validated after the
answer is written:

  quote:AAPL            fund:AAPL             fs:AAPL:2026-Q3
  fc:AAPL               ta:AAPL               news:<news_items.id>
  filing:<chunk id>     macro:FEDFUNDS        movers:losers
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Literal, Optional

from pydantic import BaseModel, Field


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class Fact(BaseModel):
    id: str
    kind: str
    source: str
    as_of: Optional[str] = None
    ticker: Optional[str] = None

    def label(self) -> str:
        return self.id

    def ui(self) -> Dict[str, Any]:
        """Compact description for the citation chip / source drawer."""
        return {"id": self.id, "kind": self.kind, "source": self.source,
                "as_of": self.as_of, "ticker": self.ticker, "label": self.label()}


class QuoteFact(Fact):
    kind: Literal["quote"] = "quote"
    price: Optional[float] = None
    change: Optional[float] = None
    change_percent: Optional[float] = None
    volume: Optional[float] = None
    previous_close: Optional[float] = None
    day_high: Optional[float] = None
    day_low: Optional[float] = None
    # Session the PRICE is from (derived from its own trade time vs the
    # exchange calendar), e.g. "regular", "after-hours", "closed (Thanksgiving Day)".
    market_session: Optional[str] = None
    market_now: Optional[str] = None        # session at the time the pack was built
    quote_time: Optional[str] = None        # last-trade time (UTC ISO); None = provider did not say
    age_minutes: Optional[float] = None     # age of quote_time when the pack was built
    stale: Optional[bool] = None            # older than the freshness limit for market_now
    freshness_note: Optional[str] = None

    def label(self) -> str:
        return f"{self.ticker} quote"

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        if self.price is not None:
            chg = f" ({self.change_percent:+.2f}%)" if self.change_percent is not None else ""
            d["snippet"] = f"${self.price:,.2f}{chg}" + (f", market {self.market_session.lower()}" if self.market_session else "")
        return d


class FundamentalsFact(Fact):
    kind: Literal["fundamentals"] = "fundamentals"
    company_name: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    market_cap: Optional[float] = None
    pe_ratio: Optional[float] = None
    forward_pe: Optional[float] = None
    peg_ratio: Optional[float] = None
    price_to_sales: Optional[float] = None
    price_to_book: Optional[float] = None
    ev_to_ebitda: Optional[float] = None
    eps_ttm: Optional[float] = None
    revenue_ttm: Optional[float] = None
    profit_margin_pct: Optional[float] = None
    operating_margin_pct: Optional[float] = None
    gross_margin_pct: Optional[float] = None
    roe_pct: Optional[float] = None
    debt_to_equity: Optional[float] = None
    current_ratio: Optional[float] = None
    dividend_yield_pct: Optional[float] = None
    beta: Optional[float] = None
    week_52_high: Optional[float] = None
    week_52_low: Optional[float] = None
    target_price: Optional[float] = None
    recommendation: Optional[str] = None
    earnings_date: Optional[str] = None

    def label(self) -> str:
        return f"{self.ticker} key stats"


class StatementPeriod(Fact):
    kind: Literal["statement"] = "statement"
    period: str                      # 2026-Q3 / 2026-FY
    period_label: str                # "Q3 FY2026" (SEC fiscal labels, not calendar)
    form: Optional[str] = None       # 10-Q / 10-K
    fiscal_year: Optional[int] = None
    fiscal_quarter: Optional[int] = None
    period_end: Optional[str] = None
    filed: Optional[str] = None
    derived: Optional[str] = None    # e.g. "Q4 = FY minus Q1..Q3"
    revenue: Optional[float] = None
    gross_profit: Optional[float] = None
    operating_income: Optional[float] = None
    net_income: Optional[float] = None
    eps_diluted: Optional[float] = None
    operating_cash_flow: Optional[float] = None
    capital_expenditures: Optional[float] = None
    free_cash_flow: Optional[float] = None
    total_assets: Optional[float] = None
    total_liabilities: Optional[float] = None
    long_term_debt: Optional[float] = None
    cash_and_equivalents: Optional[float] = None
    stockholders_equity: Optional[float] = None
    shares_diluted: Optional[float] = None
    # derived (computed here so the model never has to do arithmetic)
    gross_margin_pct: Optional[float] = None
    operating_margin_pct: Optional[float] = None
    net_margin_pct: Optional[float] = None
    revenue_yoy_pct: Optional[float] = None
    book_value_per_share: Optional[float] = None
    book_value_per_share_class: Optional[float] = None   # e.g. per BRK.B share
    share_class_note: Optional[str] = None

    def label(self) -> str:
        return f"{self.ticker} {self.period_label} ({self.form or 'SEC'})"

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        def b(v: Optional[float]) -> str:
            return f"${v / 1e9:,.2f}B" if v is not None else "n/a"
        parts = [f"Revenue {b(self.revenue)}", f"net income {b(self.net_income)}"]
        if self.gross_margin_pct is not None:
            parts.append(f"gross margin {self.gross_margin_pct}%")
        if self.revenue_yoy_pct is not None:
            parts.append(f"revenue YoY {self.revenue_yoy_pct:+}%")
        d.update(filing_type=self.form, fiscal_year=self.fiscal_year, period=self.period_label,
                 filed_date=self.filed, snippet="; ".join(parts) + (f". ({self.derived})" if self.derived else "."))
        return d


class ForecastHorizon(BaseModel):
    h: int
    date: Optional[str] = None
    p10: Optional[float] = None
    p50: Optional[float] = None
    p90: Optional[float] = None
    exp_return_pct: Optional[float] = None
    prob_up_pct: Optional[float] = None


class ForecastFact(Fact):
    kind: Literal["forecast"] = "forecast"
    model: str = "ARIMA/ETS/Theta ensemble + GJR-GARCH bands"
    generated_at: Optional[str] = None
    last_close: Optional[float] = None
    horizons: List[ForecastHorizon] = Field(default_factory=list)
    vol_annualized_pct: Optional[float] = None
    backtest_mase_vs_naive: Dict[str, Optional[float]] = Field(default_factory=dict)
    backtest_directional_accuracy: Dict[str, Optional[float]] = Field(default_factory=dict)
    note: str = "Probabilistic model output (p10-p90 = 80% band), not a prediction of certainty."

    def label(self) -> str:
        return f"{self.ticker} QuantTrade forecast"

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        d["snippet"] = "; ".join(
            f"{h.h}d: ${h.p10}–${h.p90} (median ${h.p50})" for h in self.horizons) + f". {self.model}. {self.note}"
        return d


class TechnicalsFact(Fact):
    kind: Literal["technicals"] = "technicals"
    price: Optional[float] = None
    rsi_14: Optional[float] = None
    macd: Optional[float] = None
    macd_signal: Optional[float] = None
    sma_20: Optional[float] = None
    sma_50: Optional[float] = None
    sma_200: Optional[float] = None
    atr_14: Optional[float] = None
    high_52w: Optional[float] = None
    low_52w: Optional[float] = None
    trend: Optional[str] = None
    momentum: Optional[str] = None
    volatility: Optional[str] = None
    signal_strength: Optional[float] = None

    def label(self) -> str:
        return f"{self.ticker} technicals"


class NewsFact(Fact):
    kind: Literal["news"] = "news"
    title: str
    summary: Optional[str] = None
    publisher: Optional[str] = None
    url: Optional[str] = None
    published_at: Optional[str] = None
    tickers: List[str] = Field(default_factory=list)
    category: Optional[str] = None
    sentiment_label: Optional[str] = None
    sentiment_score: Optional[float] = None
    impact: Optional[int] = None
    ai_note: Optional[str] = None
    suspicious: bool = False          # contained instruction-like text (prompt injection)

    def label(self) -> str:
        return self.title[:90]

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        d.update(title=self.title, publisher=self.publisher, url=self.url,
                 published_at=self.published_at, sentiment=self.sentiment_label,
                 category=self.category, suspicious=self.suspicious)
        return d


class FilingChunkFact(Fact):
    kind: Literal["filing"] = "filing"
    filing_type: str
    fiscal_year: Optional[int] = None
    section: Optional[str] = None
    filed_date: Optional[str] = None
    accession: Optional[str] = None
    url: Optional[str] = None
    text: str
    score: float = 0.0
    suspicious: bool = False

    def label(self) -> str:
        return f"{self.ticker} {self.filing_type} {self.fiscal_year or ''} · {self.section or 'filing'}".strip()

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        d.update(filing_type=self.filing_type, fiscal_year=self.fiscal_year, section=self.section,
                 filed_date=self.filed_date, accession=self.accession, url=self.url,
                 snippet=self.text[:600], score=round(self.score, 4))
        return d


class MacroFact(Fact):
    kind: Literal["macro"] = "macro"
    series: str
    name: str
    value: Optional[float] = None
    unit: Optional[str] = None
    observation_date: Optional[str] = None

    def label(self) -> str:
        return f"{self.name} ({self.observation_date})"


class MoversFact(Fact):
    kind: Literal["movers"] = "movers"
    direction: str
    rows: List[Dict[str, Any]] = Field(default_factory=list)

    def label(self) -> str:
        return f"Top {self.direction}"


class Identity(BaseModel):
    status: Literal["ok", "mismatch", "changed", "unknown"] = "ok"
    note: Optional[str] = None
    former_name: Optional[str] = None
    successor_symbol: Optional[str] = None


class TickerContextPack(BaseModel):
    """Everything the server knows about one ticker, built before the LLM runs."""
    ticker: str
    name: Optional[str] = None
    asset_type: str = "equity"
    identity: Identity = Field(default_factory=Identity)
    built_at: str = Field(default_factory=utcnow_iso)
    quote: Optional[QuoteFact] = None
    fundamentals: Optional[FundamentalsFact] = None
    statements: List[StatementPeriod] = Field(default_factory=list)
    forecast: Optional[ForecastFact] = None
    technicals: Optional[TechnicalsFact] = None
    news: List[NewsFact] = Field(default_factory=list)
    filings: List[FilingChunkFact] = Field(default_factory=list)
    errors: Dict[str, str] = Field(default_factory=dict)
    timings_ms: Dict[str, int] = Field(default_factory=dict)
    cached: bool = False

    def facts(self) -> Iterator[Fact]:
        for f in (self.quote, self.fundamentals, self.forecast, self.technicals):
            if f is not None:
                yield f
        yield from self.statements
        yield from self.news
        yield from self.filings

    def is_empty(self) -> bool:
        return next(self.facts(), None) is None

    def summary(self) -> Dict[str, Any]:
        """Payload of the SSE `context` event (drives the ticker card in the UI)."""
        f = self.fundamentals
        fc = self.forecast
        h20 = next((h for h in (fc.horizons if fc else []) if h.h == 20), None)
        return {
            "ticker": self.ticker,
            "name": self.name or (f.company_name if f else None),
            "asset_type": self.asset_type,
            "identity": self.identity.model_dump(),
            "built_at": self.built_at,
            "quote": self.quote.model_dump() if self.quote else None,
            "key_stats": {k: getattr(f, k) for k in (
                "market_cap", "pe_ratio", "forward_pe", "eps_ttm", "dividend_yield_pct",
                "week_52_high", "week_52_low", "beta", "target_price", "recommendation",
                "sector", "industry") if f is not None and getattr(f, k) is not None} if f else {},
            "key_stats_id": f.id if f else None,
            "forecast": ({"id": fc.id, "as_of": fc.as_of, "horizon_days": 20,
                          "p10": h20.p10, "p50": h20.p50, "p90": h20.p90,
                          "prob_up_pct": h20.prob_up_pct} if fc and h20 else None),
            "latest_statement": (self.statements[0].model_dump(include={
                "id", "period_label", "form", "revenue", "net_income", "gross_margin_pct",
                "revenue_yoy_pct", "filed"}) if self.statements else None),
            "news": [n.ui() for n in self.news[:5]],
            "filings": [c.ui() for c in self.filings[:5]],
            "errors": self.errors,
            "timings_ms": self.timings_ms,
            "cached": self.cached,
        }

    def llm_payload(self) -> Dict[str, Any]:
        """What the model sees (compact JSON in a user-role <context> block).

        Size matters: this block is re-sent on every model round.  Latest
        LLM_STATEMENT_QUARTERS quarters + LLM_STATEMENT_YEARS fiscal years
        (YoY growth is precomputed, so older periods are not needed for it;
        get_financials returns all of them), the LLM_NEWS highest-impact news
        items with clipped summaries, filing passages clipped to
        LLM_FILING_CHARS.  Facts keep their ids; nulls and fields that repeat
        another field (period == id, as_of == period_end ...) are dropped."""
        quarters = [s for s in self.statements if s.fiscal_quarter][:LLM_STATEMENT_QUARTERS]
        years = [s for s in self.statements if not s.fiscal_quarter][:LLM_STATEMENT_YEARS]
        shown = len(quarters) + len(years)
        out: Dict[str, Any] = {
            "ticker": self.ticker,
            "name": self.name,
            "asset_type": self.asset_type,
            "identity": self.identity.model_dump(exclude_none=True) if self.identity.status != "ok" or self.identity.note else None,
            "quote": compact_fact(self.quote) if self.quote else None,
            "fundamentals": compact_fact(self.fundamentals) if self.fundamentals else None,
            "financial_statements": [compact_fact(s) for s in quarters + years] or None,
            "financial_statements_more": (f"{len(self.statements) - shown} older periods: call get_financials"
                                          if len(self.statements) > shown else None),
            "forecast": compact_fact(self.forecast) if self.forecast else None,
            "technicals": compact_fact(self.technicals) if self.technicals else None,
            "news_last_7d": [compact_fact(n) for n in self.news[:LLM_NEWS]] or None,
            "filing_excerpts": [compact_fact(c) for c in self.filings] or None,
            "unavailable": self.errors or None,
        }
        return {k: v for k, v in out.items() if v is not None}


# ── compact serialisation for the model ─────────────────────────────────────
LLM_STATEMENT_QUARTERS = int(os.getenv("COPILOT_LLM_QUARTERS", "4"))
LLM_STATEMENT_YEARS = int(os.getenv("COPILOT_LLM_YEARS", "2"))
LLM_NEWS = int(os.getenv("COPILOT_LLM_NEWS", "5"))
LLM_NEWS_SUMMARY_CHARS = 240
LLM_FILING_CHARS = int(os.getenv("COPILOT_LLM_FILING_CHARS", "1400"))

# Fields the model never needs (duplicates of another field, UI-only, or
# internal); everything not listed is kept.
_DROP_ALWAYS = {"kind", "ticker"}
_DROP_BY_KIND: Dict[str, set] = {
    # id carries the period, period_label the fiscal year/quarter, form the source
    "statement": {"source", "as_of", "period", "fiscal_year", "fiscal_quarter"},
    "news": {"url", "tickers", "published_at", "sentiment_score", "source"},
    "filing": {"url", "accession", "score", "filed_date"},
    "forecast": {"generated_at"},
    "technicals": {"source"},
}


def _clip(text: str, n: int) -> str:
    if len(text) <= n:
        return text
    cut = text[:n]
    stop = max(cut.rfind(". "), cut.rfind("; "))
    return (cut[:stop + 1] if stop > n * 0.6 else cut.rsplit(" ", 1)[0]) + " ..."


def _num(v: Any) -> Any:
    """Shorter JSON for numbers without changing what can be cited: whole or
    large values lose the '.0' / float noise, small ones keep 4 decimals."""
    if isinstance(v, float):
        if abs(v) >= 1000 or v == int(v):
            return int(round(v))
        return round(v, 4)
    if isinstance(v, dict):
        return {k: _num(x) for k, x in v.items() if x is not None}
    if isinstance(v, list):
        return [_num(x) for x in v]
    return v


def compact_fact(f: Fact) -> Dict[str, Any]:
    drop = _DROP_ALWAYS | _DROP_BY_KIND.get(f.kind, set())
    d = {k: _num(v) for k, v in f.model_dump(exclude_none=True).items() if k not in drop}
    if d.get("suspicious") is False:
        d.pop("suspicious")
    if f.kind == "news" and d.get("summary"):
        d["summary"] = _clip(d["summary"], LLM_NEWS_SUMMARY_CHARS)
    if f.kind == "filing" and d.get("text"):
        d["text"] = _clip(d["text"], LLM_FILING_CHARS)
    if f.kind == "forecast":
        for h in d.get("horizons") or []:
            h.pop("date", None)
    return d
