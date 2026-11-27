"""Planner for long, multi-part ("deep") institutional questions.

1. ``is_deep`` decides whether a question needs the deep pipeline (a bigger
   tool budget, longer per-tool timeouts, a structured answer, a grounding
   repair pass).
2. ``build_plan`` decomposes the question into required computations and
   retrievals (``CAPABILITIES``: DCF, WACC, risk metrics, event study, filing
   comparison ...) and maps each one to tools DISCOVERED from the tool
   registry (``tools.all_tool_specs``): a tool is matched by its name family
   (``valuation_*``, ``quant_*`` ...) and keyword overlap with its name and
   description, never by a hard-coded tool name.  New engines show up in plans
   as soon as they are registered.
3. ``prefetch`` runs every planned call whose required arguments the planner
   can fill (ticker(s), years, number of simulations, ...) in parallel, with a
   per-call timeout and a concurrency cap, before the first model round, and
   reports progress ("Fetching 5y statements for NVDA").

A step with no matching tool is marked ``unavailable``.  The model is told it
must state that the computation was not executed, and the composer adds that
to Limitations; nothing is estimated in its place.
"""
from __future__ import annotations

import asyncio
import os
import re
from dataclasses import asdict, dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional, Sequence, Tuple

from app.services.copilot.tools import all_tool_specs
from app.services.copilot.valuation_tools import FCFF_TOOLS as _VAL_FCFF_TOOLS

# ── budgets (env-configurable) ───────────────────────────────────────────────
DEEP_MODE = os.getenv("COPILOT_DEEP_MODE", "auto").lower()            # auto | always | never
DEEP_MIN_CHARS = int(os.getenv("COPILOT_DEEP_MIN_CHARS", "220"))
DEEP_MAX_TOOL_ROUNDS = int(os.getenv("COPILOT_DEEP_MAX_TOOL_ROUNDS", "6"))
DEEP_MAX_TOOL_CALLS = int(os.getenv("COPILOT_DEEP_MAX_TOOL_CALLS", "40"))
DEEP_TOOL_TIMEOUT_S = float(os.getenv("COPILOT_DEEP_TOOL_TIMEOUT_S", "30"))
DEEP_PREFETCH_MAX = int(os.getenv("COPILOT_DEEP_PREFETCH_MAX", "24"))
DEEP_PARALLEL = int(os.getenv("COPILOT_DEEP_PARALLEL", "6"))
DEEP_MAX_TICKERS = int(os.getenv("COPILOT_DEEP_MAX_TICKERS", "8"))
MIN_TOOL_SCORE = 3
MAX_TOOLS_PER_STEP = 2

# Data that is already in every ticker context pack (no prefetch needed).
PACK_COVERED = {"get_quote", "get_fundamentals", "get_financials", "get_forecast", "get_news"}

DEEP_HINTS = re.compile(
    r"\b(dcf|wacc|monte carlo|simulations?|sensitivity|scenarios?|stress|backtest\w*|event study|"
    r"abnormal returns?|value at risk|var|sharpe|sortino|beta|drawdown|hurst|autocorrelation|regime|"
    r"altman|piotroski|beneish|dupont|roic|accruals?|forensic|intrinsic value|correlations?|"
    r"marginal contribution|ev/ebitda|reconcil\w*|cross-reference|obligations|percentiles?|"
    r"free cash flow yield|cost of capital|10-k filings|risk[- ]factor)\b", re.I)


def is_deep(message: str) -> bool:
    if DEEP_MODE == "always":
        return True
    if DEEP_MODE == "never":
        return False
    msg = message or ""
    hits = len({m.group(0).lower() for m in DEEP_HINTS.finditer(msg)})
    caps = sum(1 for c in CAPABILITIES if re.search(c.pattern, msg, re.I))
    long_q = len(msg) >= DEEP_MIN_CHARS
    return (long_q and (hits >= 1 or caps >= 2)) or hits >= 3 or caps >= 4


# ── capabilities ─────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Capability:
    key: str
    label: str
    pattern: str                         # regex on the question
    keywords: Tuple[str, ...]            # matched against tool name / description
    families: Tuple[str, ...] = ()       # tool-name prefixes that own this capability
    computation: bool = True             # needs execution (vs retrieval)
    query: str = ""                      # filing-search query when a tool takes one
    exclude: Tuple[str, ...] = ()        # tools that match by keyword but answer a different question


# Engine families.  A family is a tool-name prefix; the engines shipped with the
# copilot do not share one prefix per engine, so their tool names are listed as
# (exact) prefixes too.  New tools still get discovered by keyword + family.
FUND = ("fundamentals_", "get_financial_history", "analyze_earnings_quality", "analyze_capital_efficiency",
        "dupont_analysis", "assess_financial_distress", "compare_peer_fundamentals")
VAL = ("valuation_",)
QUANT = ("quant_", "analyze_price_behavior", "get_risk_metrics", "earnings_event_study",
         "analyze_portfolio_risk", "backtest_strategy")
FIL = ("filings_", "sec_")


CAPABILITIES: Tuple[Capability, ...] = (
    Capability("statements", "Multi-year financial statements (SEC XBRL)",
               r"financial statements|income statement|balance sheet|cash flows?|five years|5 years|"
               r"last \w+ years|past \w+ years|historical financials",
               ("statements", "financials", "history", "annual", "xbrl", "income statement", "financial statements"),
               FUND, computation=False),
    Capability("earnings_quality", "Earnings quality: accruals, cash conversion, working capital",
               r"forensic|accrual|earnings quality|working capital|cash conversion|operating cash flow|"
               r"adjusted operating income|stock-based compensation",
               ("accrual", "accruals", "quality", "forensic", "working capital", "cash conversion", "earnings quality", "sbc"),
               FUND),
    Capability("returns_on_capital", "ROIC vs WACC / incremental returns",
               r"\broic\b|return on invested capital|capital efficiency|incremental return",
               ("roic", "invested capital", "returns", "nopat", "incremental"), FUND + VAL),
    Capability("dupont", "DuPont ROE decomposition", r"dupont|decompose roe|\broe\b|return on equity",
               ("dupont", "roe", "return on equity", "asset turnover", "leverage"), FUND),
    Capability("distress", "Distress models (Altman Z, Piotroski F, Beneish M)",
               r"altman|z-score|piotroski|f-score|beneish|m-score|distress",
               ("altman", "piotroski", "beneish", "distress", "z-score", "zscore", "f-score", "m-score"), FUND),
    Capability("leverage_liquidity", "Leverage, liquidity, interest coverage, debt maturities",
               # "financial leverage" (DuPont) and "operating leverage" (margins) are other questions
               r"interest coverage|debt maturit\w*|maturity schedule|liquidity|solvency|"
               r"(?<!financial )(?<!operating )\bleverage\b",
               ("coverage", "maturity", "liquidity", "leverage", "debt", "solvency"), FUND),
    Capability("wacc", "Cost of capital (WACC / CAPM)", r"\bwacc\b|cost of capital|discount rates?",
               ("wacc", "cost of capital", "capm", "discount rate", "cost of equity"), VAL),
    Capability("dcf", "Discounted cash flow valuation", r"discounted cash flow|\bdcf\b|intrinsic value|three-stage",
               ("dcf", "discounted cash flow", "intrinsic", "intrinsic value", "fcff"), VAL),
    Capability("reverse_dcf", "Reverse DCF / market-implied expectations",
               r"reverse dcf|market[- ]implied|implied (growth|expectations)|justify its current",
               ("reverse", "implied", "reverse dcf", "market implied"), VAL),
    Capability("sensitivity", "Sensitivity analysis", r"sensitivity|matrix",
               ("sensitivity", "matrix", "grid"), VAL + QUANT,
               exclude=("valuation_rate_sensitivity",)),        # bank-only; see bank_rate_sensitivity
    Capability("multiples", "Relative valuation multiples (EV/EBITDA, P/E, FCF yield)",
               r"ev/ebitda|enterprise value|forward p/e|p/e\b|fcf yield|free cash flow yield|peer valuation|"
               r"valuation ranking|multiples",
               ("multiples", "ev/ebitda", "ebitda", "peers", "peer", "comparables", "fcf yield", "relative",
                "p/e"), VAL),
    Capability("monte_carlo", "Monte Carlo simulation", r"monte carlo|simulations?",
               ("monte", "carlo", "monte carlo", "simulation", "simulations", "probabilistic", "stochastic"),
               VAL + QUANT),
    Capability("scenarios", "Scenario / stress analysis",
               # "downside beta" is a risk metric; a "sector correction" in a portfolio question is the
               # portfolio tool's hypothetical shock, not a company DCF scenario
               r"scenarios?|\bstress|bull|bear|downside(?! (?:beta|deviation|capture|volatility))|shock|tariffs?|"
               r"export restrictions?|geopolitical|appreciation of the us dollar",
               ("scenario", "scenarios", "stress", "shock", "bull", "bear", "what-if"), VAL + QUANT),
    Capability("volatility_regime", "Volatility, Hurst exponent, autocorrelation, regimes",
               r"volatility|hurst|autocorrelation|regime|mean reversion|momentum",
               ("volatility", "hurst", "autocorrelation", "regime", "rolling", "mean reversion"), QUANT),
    Capability("risk_metrics", "Risk metrics (beta, alpha, Sharpe, Sortino, drawdown, VaR)",
               r"\bbeta\b|alpha|sharpe|sortino|drawdown|value at risk|\bvar\b",
               ("beta", "sharpe", "sortino", "drawdown", "var", "value at risk", "alpha", "risk metrics"), QUANT,
               exclude=("backtest_strategy",)),
    Capability("event_study", "Earnings event study (abnormal returns)",
               r"event study|abnormal returns?|earnings announcements?|eps surprises?",
               ("event", "event study", "abnormal", "announcement", "surprise", "car"), QUANT),
    Capability("backtest", "Strategy backtest", r"backtest|strategy|\brsi\b|moving average|buy-and-hold|slippage|out-of-sample",
               ("backtest", "strategy", "rsi", "signal", "slippage", "transaction cost"), QUANT),
    Capability("portfolio", "Portfolio correlation / risk contribution",
               # "securities portfolio" (bank AFS/HTM) and "autocorrelation" are not portfolio questions
               r"(?<!securities )(?<!investment )\bportfolio\b|\bcorrelations?\b|diversif|marginal contribution|"
               r"factor concentration",
               ("portfolio", "correlation", "covariance", "diversification", "contribution", "factor"), QUANT,
               exclude=("factor_regression",)),                 # single-stock Fama-French, not portfolio risk
    Capability("macro_factors", "Rates / macro factor sensitivity",
               # "free cash flow yield" / "dividend yield" are valuation multiples, not rates
               r"treasury|(?<!flow )(?<!fcf )(?<!dividend )(?<!earnings )\byields?\b|interest rates?|basis[- ]points?|"
               r"macro|us dollar|consumer discretionary",
               ("macro", "rates", "treasury", "yield", "factor", "fred"), QUANT + ("macro_", "get_macro"),
               exclude=("get_risk_metrics",)),                  # market beta is not a macro-factor exposure
    Capability("bank_rate_sensitivity", "Bank rate sensitivity (NII, deposits, AOCI, credit losses)",
               r"net interest income|deposit costs?|securities portfolio|credit losses",
               ("net interest income", "nii", "deposit", "rate sensitivity", "interest rate risk"),
               FIL + FUND, query="net interest income sensitivity to interest rates"),
    Capability("filings_compare", "Cross-filing comparison (10-K / 10-Q / 8-K)",
               r"10-k|10-q|8-k|risk[- ]factor|material changes|cross-reference|filings",
               ("filings", "filing", "10-k", "risk factors", "compare", "diff", "changes", "section", "excerpt"),
               FIL, computation=False, query="risk factors material changes"),
    Capability("disclosures", "Primary disclosures (notes, obligations, segments, guidance)",
               r"contractual obligations|deferred revenue|remaining performance obligations|leases?|"
               r"capital expenditure commitments|guidance|revenue recognition|customer concentration|"
               r"geographic|inventory|depreciation|segment|cloud revenue|cross-border|transaction volume|"
               r"regulatory|disclosures?",
               ("disclosure", "disclosures", "filings", "xbrl", "notes", "obligations", "segment", "footnote", "passages"),
               FIL + FUND, computation=False, query="contractual obligations commitments guidance"),
    Capability("market_value", "Current market value (price, market cap)",
               r"market cap|market capitali[sz]ation|current (share )?price|current market valuation|implied valuation",
               ("quote", "price", "market cap"), (), computation=False, exclude=QUANT),
    Capability("capex", "Capital intensity / capex / depreciation",
               r"capital (expenditure|intensity)|capex|depreciation burden|infrastructure invest",
               ("capex", "capital expenditure", "depreciation", "intensity", "reinvestment"), FUND),
    Capability("growth_margins", "Growth and margins", r"revenue growth|gross margin|operating margin|operating leverage|margins?",
               ("growth", "margin", "margins", "revenue", "operating leverage"), FUND),
)


# ── plan model ───────────────────────────────────────────────────────────────
@dataclass
class PlannedCall:
    tool: str
    args: Dict[str, Any]
    label: str


@dataclass
class PlanStep:
    id: str
    capability: str
    need: str
    computation: bool
    tools: List[str] = field(default_factory=list)
    calls: List[PlannedCall] = field(default_factory=list)     # prefetchable
    status: str = "planned"            # planned | in_context | done | partial | failed | unavailable
    fact_ids: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    note: Optional[str] = None
    shared_with: List[str] = field(default_factory=list)   # step ids whose prefetch calls cover this step

    def public(self) -> Dict[str, Any]:
        d = {"id": self.id, "need": self.need, "capability": self.capability, "status": self.status,
             "tools": self.tools, "computation": self.computation,
             "calls": [{"tool": c.tool, "args": c.args} for c in self.calls],
             "fact_ids": self.fact_ids[:12], "errors": self.errors[:3]}
        if self.note:
            d["note"] = self.note
        if self.shared_with:
            d["covered_by"] = self.shared_with
        return d


@dataclass
class Plan:
    question: str
    tickers: List[str]
    deep: bool
    steps: List[PlanStep] = field(default_factory=list)
    budget: Dict[str, Any] = field(default_factory=dict)

    @property
    def unavailable(self) -> List[PlanStep]:
        return [s for s in self.steps if s.status in ("unavailable", "failed")]

    def event(self) -> Dict[str, Any]:
        return {"deep": self.deep, "tickers": self.tickers, "budget": self.budget,
                "steps": [{"id": s.id, "label": s.need, "capability": s.capability, "status": s.status,
                           "tools": s.tools, "computation": s.computation} for s in self.steps]}

    def llm_payload(self) -> Dict[str, Any]:
        return {"tickers": self.tickers,
                "rules": ["Use tool outputs for every number; cite their ids.",
                          "Steps with status 'unavailable' or 'failed' were NOT executed: say so explicitly in "
                          "Results and Limitations and do not estimate, simulate or invent their outputs.",
                          "Steps with status 'planned' still need a tool call (use the listed tools/args)."],
                "steps": [s.public() for s in self.steps], "budget": self.budget}


# ── tool discovery ───────────────────────────────────────────────────────────
def _tool_text(spec: Dict[str, Any]) -> Tuple[str, set, set]:
    name = spec["name"].lower()
    desc = (spec.get("description") or "").lower()
    name_toks = set(re.split(r"[_\W]+", name)) - {""}
    toks = name_toks | set(re.findall(r"[a-z0-9/+-]+", desc))
    return f"{name.replace('_', ' ')} {desc}", name_toks, toks


def score_tool(cap: Capability, spec: Dict[str, Any]) -> int:
    if any(spec["name"].lower().startswith(x) for x in cap.exclude):
        return 0
    text, name_toks, toks = _tool_text(spec)
    family = any(spec["name"].lower().startswith(f) for f in cap.families)
    s = 2 if family else 0
    kw_hits = 0
    for kw in cap.keywords:
        kw = kw.lower()
        if " " in kw or "-" in kw or "/" in kw:
            if kw in text or kw.replace(" ", "_") in spec["name"].lower():
                s += 2; kw_hits += 1
        elif kw in name_toks:
            s += 3; kw_hits += 1
        elif kw in toks:
            s += 1; kw_hits += 1
    return s if kw_hits else 0


def discover_tools(cap: Capability, specs: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    scored = sorted(((score_tool(cap, s), i, s) for i, s in enumerate(specs)), key=lambda x: (-x[0], x[1]))
    return [s for sc, _, s in scored if sc >= MIN_TOOL_SCORE][:MAX_TOOLS_PER_STEP]


# ── argument filling ─────────────────────────────────────────────────────────
_WORDNUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
            "nine": 9, "ten": 10, "twelve": 12, "fifteen": 15, "twenty": 20}


def _num(tok: str) -> Optional[int]:
    tok = tok.lower().replace(",", "")
    if tok.isdigit():
        return int(tok)
    return _WORDNUM.get(tok)


def question_hints(q: str) -> Dict[str, Any]:
    """Numbers the question asks for explicitly (they are parameters, not data)."""
    h: Dict[str, Any] = {}
    m = re.search(r"(?:last|past|previous)\s+(\w+)\s+years|(\w+)\s+years\s+of", q, re.I)
    if m and _num(m.group(1) or m.group(2)):
        h["lookback_years"] = _num(m.group(1) or m.group(2))
    m = re.search(r"next\s+(\w+)\s+years", q, re.I)
    if m and _num(m.group(1)):
        h["horizon_years"] = _num(m.group(1))
    m = re.search(r"([\d,]+)\s+(?:monte carlo\s+)?(?:simulations|paths|trials|draws)", q, re.I)
    if m and _num(m.group(1)):
        h["n_simulations"] = _num(m.group(1))
    m = re.search(r"last\s+(\w+)\s+(?:quarterly\s+)?(?:earnings|quarters)", q, re.I)
    if m and _num(m.group(1)):
        h["n_events"] = _num(m.group(1))
    windows = [int(x) for x in re.findall(r"(\d{2,3})-day", q)]
    if windows:
        h["windows"] = windows
    m = re.search(r"(\w+)[- ]day event window", q, re.I)
    if m and _num(m.group(1)):
        h["event_window"] = _num(m.group(1))
    m = re.search(r"(\d+)[- ]basis[- ]points?", q, re.I)
    if m:
        h["shock_bps"] = int(m.group(1))
    m = re.search(r"(\d{2})%\s+(?:historical|parametric|confidence|var|value at risk)", q, re.I)
    if m:
        h["confidence"] = int(m.group(1)) / 100
    if re.search(r"s&p\s*500", q, re.I):
        h["benchmark"] = "SPY"
    forms = re.findall(r"\b(10-K|10-Q|8-K)\b", q, re.I)
    if forms:
        h["forms"] = list(dict.fromkeys(f.upper() for f in forms))
    m = re.search(r"(\w+) most recent annual", q, re.I)
    if m and _num(m.group(1)):
        h["n_filings"] = _num(m.group(1))
    return h


# ── scenario shocks named in the question ──────────────────────────────────
# shock key -> (keyword regex, sign applied to an explicit "N%" in the clause).
# Keys are the valuation scenario engine's shock names (valuation.scenarios.SHOCKS).
_SHOCK_WORDS: Tuple[Tuple[str, str, float], ...] = (
    ("reporting_currency_appreciation",
     r"(?:apprecia\w*|strengthen\w*|strong(?:er)?|rise|rising|gains?)\W+(?:\w+\W+){0,4}?(?:u\.?s\.?\s+)?dollar|"
     r"(?:u\.?s\.?\s+)?dollar\W+(?:\w+\W+){0,2}?(?:apprecia\w*|strengthen\w*|rises?|gains?)|\busd\s*\+", 1.0),
    ("tariff_rate", r"tariffs?", 1.0),
    ("demand_decline",
     r"(?:declin\w*|lower|weak\w*|fall\w*|slow\w*|drop\w*|reduc\w*)\s+(?:\w+\s+){0,3}?(?:demand|spending|volumes?)|"
     r"(?:demand|spending|volumes?)\s+(?:\w+\s+){0,2}?(?:declin\w*|falls?|drops?|slow\w*|weaken\w*)", 1.0),
    ("cogs_inflation",
     r"(?:manufacturing|input|production|component|unit|raw[- ]material)\s+costs?|cost inflation|\bcogs\b\s+(?:inflation|increase)",
     1.0),
    ("revenue_change", r"export restrictions?|export controls?|loss of (?:\w+\s+){0,2}revenue", -1.0),
    ("gross_margin_change", r"margin (?:deterioration|compression|pressure|erosion|decline)", -1.0),
    ("rate_shock", r"interest[- ]rates?\s+(?:rise|increase|shock)|treasury yields?|basis[- ]points?", 1.0),
)
_PCT = re.compile(r"([+-]?\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b)")
_BP = re.compile(r"(\d+)[- ]?(?:basis[- ]points?|bps?\b)")
_TARIFF_SHARE = re.compile(r"(\d+(?:\.\d+)?)\s*%\s+of\s+(?:its\s+|their\s+)?(?:cogs|cost of (?:goods|revenue|sales))", re.I)


def question_shocks(q: str) -> Dict[str, Any]:
    """Scenario shocks the question names.  Returns
    {"shocks": {key: fraction}} for shocks with an explicit size,
    {"default_shocks": [keys]} for shocks named without one, and
    {"structure": {...}} for structural inputs it states (tariff-exposed COGS
    share).  A tariff shock without an exposed-COGS share is left to the tool
    to report as not computable; nothing here is guessed."""
    out: Dict[str, Any] = {}
    shocks: Dict[str, float] = {}
    named: List[str] = []
    text = q or ""
    share = _TARIFF_SHARE.search(text)
    if share:
        out["structure"] = {"tariff_exposed_cogs_share": float(share.group(1)) / 100}
    for clause in re.split(r"[;:]|,\s*|\s+and\s+|\s+while\s+", text, flags=re.I):
        for key, rx, sign in _SHOCK_WORDS:
            if key in shocks or key in named or not re.search(rx, clause, re.I):
                continue
            if key == "rate_shock":
                bp = _BP.search(clause)
                if bp:
                    shocks[key] = int(bp.group(1)) / 10000
                else:
                    named.append(key)
                continue
            m = _PCT.search(clause if not share else clause.replace(share.group(0), ""))
            if m:
                v = abs(float(m.group(1))) / 100
                if key == "reporting_currency_appreciation" and re.search(r"deprecia|weak", clause, re.I):
                    v = -v
                shocks[key] = sign * v
            else:
                named.append(key)
    if shocks:
        out["shocks"] = shocks
    named = [k for k in named if k not in shocks]
    if named:
        out["default_shocks"] = named
    return out


# Banks: an FCFF DCF (and everything built on it) is not meaningful when
# deposits and borrowings are operating liabilities; route to rate sensitivity
# and an excess-return framing instead.
BANK_HINTS = re.compile(r"net interest income|\bnii\b|deposit (?:costs?|betas?)|\bdeposits\b|\bbanks?\b|"
                        r"\bbanking\b|loan losses|credit losses|net interest margin", re.I)
FCFF_TOOLS = tuple(sorted(_VAL_FCFF_TOOLS))
BANK_RATE_TOOL = "valuation_rate_sensitivity"
BANK_NOTE = ("Bank: FCFF DCF tools are not used (deposits/borrowings are operating liabilities, so FCFF and WACC "
             "are not meaningful). Use the disclosed NII rate sensitivity and an excess-return framing: value = "
             "book equity + PV((ROE - cost of equity) x book equity), cost of equity from CAPM.")


# property name -> hint key
_ARG_ALIASES = {
    "years": "lookback_years", "lookback_years": "lookback_years", "n_years": "lookback_years",
    "history_years": "lookback_years", "lookback": "lookback_years",
    "horizon_years": "horizon_years", "forecast_years": "horizon_years", "projection_years": "horizon_years",
    "n_simulations": "n_simulations", "n_sims": "n_simulations", "simulations": "n_simulations",
    "num_simulations": "n_simulations", "n_paths": "n_simulations", "paths": "n_simulations",
    "n_events": "n_events", "quarters": "n_events", "n_quarters": "n_events", "events": "n_events",
    "windows": "windows", "event_window": "event_window", "window_days": "event_window",
    "shock_bps": "shock_bps", "rate_shock_bps": "shock_bps", "bps": "shock_bps", "shock_bp": "shock_bps",
    "confidence": "confidence", "confidence_level": "confidence", "var_confidence": "confidence",
    "benchmark": "benchmark", "market": "benchmark",
    "forms": "forms", "filing_types": "forms", "n_filings": "n_filings", "count": "n_filings",
}
_TICKER_KEYS = ("ticker", "symbol")
_TICKERS_KEYS = ("tickers", "symbols")


def _coerce(value: Any, prop: Dict[str, Any]) -> Any:
    t = prop.get("type")
    if t == "integer" and isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    if t == "number" and isinstance(value, (int, float)):
        return value
    if t == "string":
        if isinstance(value, list):
            value = value[0] if value else None
        if isinstance(value, str) and (not prop.get("enum") or value in prop["enum"]):
            return value
        return None
    if t == "array" and isinstance(value, list):
        enum = (prop.get("items") or {}).get("enum")
        vals = [v for v in value if not enum or v in enum]
        return vals or None
    return value if t is None else None


_ENUM_MAX_CALLS = 3


def _norm_words(text: str) -> str:
    return " " + re.sub(r"[^a-z0-9]+", " ", (text or "").lower()) + " "


def enum_matches(prop: Dict[str, Any], text: str) -> List[str]:
    """Enum values of a string parameter that the question names (``operating_leases``
    matches "operating lease"); used to fill required selector arguments such as a
    filing section or disclosure topic.  Never guesses a value the text does not name."""
    words = _norm_words(text)
    out = []
    for v in prop.get("enum") or []:
        if not isinstance(v, str):
            continue
        parts = [w for w in re.split(r"[^a-z0-9]+", v.lower()) if w]
        if not parts:
            continue
        pat = r"\s".join(re.escape(w[:-1] if len(w) > 3 and w.endswith("s") else w) + "s?" for w in parts)
        if re.search(r"\s" + pat + r"\s", words):
            out.append(v)
    return out[:_ENUM_MAX_CALLS]


def suggest_calls(spec: Dict[str, Any], tickers: Sequence[str], hints: Dict[str, Any],
                  cap: Capability, question: str = "") -> List[Dict[str, Any]]:
    """Argument sets for one tool, or [] when a required argument cannot be filled."""
    schema = spec.get("input_schema") or {}
    props: Dict[str, Any] = schema.get("properties") or {}
    required = list(schema.get("required") or [])
    base: Dict[str, Any] = {}
    scen = (question_shocks(question) if "reporting_currency_appreciation" in
            str((props.get("shocks") or {}).get("description") or "") else {})
    for p, prop in props.items():
        key = _ARG_ALIASES.get(p)
        if key and key in hints:
            v = _coerce(hints[key], prop)
            if v is not None:
                base[p] = v
        elif p == "query":
            base[p] = cap.query or cap.label
        elif p == "shocks" and scen.get("shocks"):
            base[p] = scen["shocks"]                     # sizes stated in the question
        elif p == "use_default_shocks" and scen.get("default_shocks"):
            base[p] = scen["default_shocks"]             # named without a size: tool applies documented defaults
        elif p == "structure" and scen.get("structure"):
            base[p] = scen["structure"]
    # required enum selectors (section / topic ...) named by the question or the capability
    variants: List[Dict[str, Any]] = [{}]
    for p in required:
        prop = props.get(p) or {}
        if p in base or prop.get("type") != "string" or not prop.get("enum"):
            continue
        vals = enum_matches(prop, question) or enum_matches(prop, cap.query)
        if vals:
            variants = [{**v, p: x} for v in variants for x in vals][:_ENUM_MAX_CALLS]
    tk = next((k for k in _TICKERS_KEYS if k in props), None)
    t1 = next((k for k in _TICKER_KEYS if k in props), None)
    out: List[Dict[str, Any]] = []
    for var in variants:
        b = {**base, **var}
        if tk:
            mx = (props[tk].get("maxItems") or 10)
            mn = (props[tk].get("minItems") or 1)
            if len(tickers) >= mn:
                out.append({**b, tk: list(tickers)[:mx]})
        elif t1:
            out.extend({**b, t1: t} for t in tickers)
        else:
            out.append(dict(b))
    return [a for a in out if all(r in a for r in required)]


# ── progress labels ──────────────────────────────────────────────────────────
class _SafeDict(dict):
    def __missing__(self, k):
        return "{" + k + "}"


def progress_label(name: str, args: Dict[str, Any], spec: Optional[Dict[str, Any]] = None,
                   template: Optional[str] = None) -> str:
    tpl = template or (spec or {}).get("progress")
    if tpl:
        try:
            out = tpl.format_map(_SafeDict(args))
            if "{" not in out:
                return out
        except (ValueError, TypeError):
            pass
    who = args.get("ticker") or args.get("symbol") or ", ".join(args.get("tickers") or args.get("symbols") or [])
    suffix = f" for {who}" if who else ""
    sims = next((args[k] for k in ("n_simulations", "n_sims", "simulations", "num_simulations", "n_paths") if k in args), None)
    if sims:
        return f"Running {int(sims):,} simulations{suffix}"
    yrs = next((args[k] for k in ("years", "lookback_years", "n_years") if k in args), None)
    n = name.lower()
    if yrs and ("statement" in n or "financial" in n or "fundamental" in n):
        return f"Fetching {yrs}y statements{suffix}"
    if "filing" in n:
        return f"Reading SEC filings{suffix}"
    if n.startswith("get_"):
        return f"Fetching {n[4:].replace('_', ' ')}{suffix}"
    return f"Running {n.replace('_', ' ')}{suffix}"


# ── plan ─────────────────────────────────────────────────────────────────────
def build_plan(question: str, tickers: Sequence[str], extra: Optional[Dict[str, Dict[str, Any]]] = None,
               deep: bool = True) -> Plan:
    specs = all_tool_specs(extra)
    by_name = {s["name"]: s for s in specs}
    hints = question_hints(question)
    plan = Plan(question=question, tickers=list(tickers), deep=deep,
                budget={"max_tool_rounds": DEEP_MAX_TOOL_ROUNDS, "max_tool_calls": DEEP_MAX_TOOL_CALLS,
                        "tool_timeout_s": DEEP_TOOL_TIMEOUT_S, "parallel": DEEP_PARALLEL, "hints": hints})
    n_prefetch = 0
    bank = bool(BANK_HINTS.search(question or ""))
    for cap in CAPABILITIES:
        if not re.search(cap.pattern, question or "", re.I):
            continue
        if cap.key == "portfolio" and len(tickers) < 2:
            continue                       # a one-name "portfolio" has no correlations / risk contributions
        tools = discover_tools(cap, specs)
        note = None
        if bank and any(t["name"] in FCFF_TOOLS for t in tools):
            tools = [t for t in tools if t["name"] not in FCFF_TOOLS]
            if cap.key in ("dcf", "sensitivity", "scenarios", "reverse_dcf", "monte_carlo") and BANK_RATE_TOOL in by_name \
                    and all(t["name"] != BANK_RATE_TOOL for t in tools):
                tools = [by_name[BANK_RATE_TOOL]] + tools[:MAX_TOOLS_PER_STEP - 1]
            note = BANK_NOTE
        step = PlanStep(id=f"S{len(plan.steps) + 1}", capability=cap.key, need=cap.label,
                        computation=cap.computation, tools=[t["name"] for t in tools], note=note)
        if not tools:
            step.status = "unavailable"
            step.errors.append("no registered tool performs this computation")
        elif all(t in PACK_COVERED for t in step.tools):
            step.status = "in_context"
        else:
            for t in tools:
                if t["name"] in PACK_COVERED:
                    continue
                for args in suggest_calls(t, tickers, hints, cap, question):
                    if n_prefetch >= DEEP_PREFETCH_MAX:
                        break
                    owner = next((s for s in plan.steps for c in s.calls if c.tool == t["name"] and c.args == args), None)
                    if owner is not None:              # already prefetched for another step: share its result
                        if owner.id not in step.shared_with:
                            step.shared_with.append(owner.id)
                        continue
                    step.calls.append(PlannedCall(t["name"], args, progress_label(
                        t["name"], args, by_name.get(t["name"]), (extra or {}).get(t["name"], {}).get("progress")
                        or _plugin_progress(t["name"]))))
                    n_prefetch += 1
        plan.steps.append(step)
    return plan


def _plugin_progress(name: str) -> Optional[str]:
    from app.services.copilot.tools import PLUGIN_TOOLS
    return (PLUGIN_TOOLS.get(name) or {}).get("progress")


async def prefetch(plan: Plan, executor, parallel: int = DEEP_PARALLEL
                   ) -> AsyncIterator[Tuple[str, Dict[str, Any]]]:
    """Run every prefetchable call concurrently (semaphore-bounded, per-call
    timeout inside the executor).  Yields ("progress"| "tool" | "result", data)
    events; "result" carries (step, call, content, facts, is_error)."""
    sem = asyncio.Semaphore(max(1, parallel))
    queue: asyncio.Queue = asyncio.Queue()
    jobs: List[Tuple[PlanStep, PlannedCall]] = [(s, c) for s in plan.steps for c in s.calls]
    if not jobs:
        return

    async def one(step: PlanStep, call: PlannedCall, n: int):
        async with sem:
            await queue.put(("progress", {"step_id": step.id, "label": call.label, "status": "running", "args": call.args,
                                          "tool": call.tool, "id": f"pf_{n}"}))
            content, facts, is_err = await executor.run(call.tool, call.args)
            await queue.put(("result", (step, call, content, facts, is_err, n)))

    tasks = [asyncio.create_task(one(s, c, n)) for n, (s, c) in enumerate(jobs)]
    pending = len(tasks)
    while pending:
        kind, data = await queue.get()
        if kind == "result":
            pending -= 1
            step, call, content, facts, is_err, n = data
            if is_err:
                step.errors.append(content[:200])
            else:
                step.fact_ids += [f.id for f in facts]
            yield "progress", {"step_id": step.id, "label": call.label, "tool": call.tool, "id": f"pf_{n}",
                               "status": "error" if is_err else "done", "facts": len(facts),
                               "error": content[:200] if is_err else None}
            yield "result", {"step": step, "call": call, "content": content, "facts": facts, "is_error": is_err,
                             "id": f"pf_{n}"}
        else:
            yield kind, data
    await asyncio.gather(*tasks, return_exceptions=True)
    for s in plan.steps:
        if s.calls:
            ok = bool(s.fact_ids)
            s.status = "done" if ok and not s.errors else "partial" if ok else "failed"
    by_id = {s.id: s for s in plan.steps}
    for s in plan.steps:
        if not s.calls and s.shared_with:      # covered entirely by another step's calls
            owners = [by_id[i] for i in s.shared_with if i in by_id]
            s.fact_ids = [f for o in owners for f in o.fact_ids]
            s.errors = [e for o in owners for e in o.errors]
            ok = bool(s.fact_ids)
            s.status = "done" if ok and not s.errors else "partial" if ok else "failed"


def plan_dict(plan: Plan) -> Dict[str, Any]:
    return asdict(plan)
