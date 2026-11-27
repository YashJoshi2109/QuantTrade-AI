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


CAPABILITIES: Tuple[Capability, ...] = (
    Capability("statements", "Multi-year financial statements (SEC XBRL)",
               r"financial statements|income statement|balance sheet|cash flows?|five years|5 years|"
               r"last \w+ years|past \w+ years|historical financials",
               ("statements", "financials", "history", "annual", "xbrl", "income statement", "financial statements"),
               ("fundamentals_",), computation=False),
    Capability("earnings_quality", "Earnings quality: accruals, cash conversion, working capital",
               r"forensic|accrual|earnings quality|working capital|cash conversion|operating cash flow|"
               r"adjusted operating income|stock-based compensation",
               ("accrual", "accruals", "quality", "forensic", "working capital", "cash conversion", "earnings quality", "sbc"),
               ("fundamentals_",)),
    Capability("returns_on_capital", "ROIC vs WACC / incremental returns",
               r"\broic\b|return on invested capital|capital efficiency|incremental return",
               ("roic", "invested capital", "returns", "nopat", "incremental"), ("fundamentals_", "valuation_")),
    Capability("dupont", "DuPont ROE decomposition", r"dupont|decompose roe|\broe\b|return on equity",
               ("dupont", "roe", "return on equity", "asset turnover", "leverage"), ("fundamentals_",)),
    Capability("distress", "Distress models (Altman Z, Piotroski F, Beneish M)",
               r"altman|z-score|piotroski|f-score|beneish|m-score|distress",
               ("altman", "piotroski", "beneish", "distress", "z-score", "zscore", "f-score", "m-score"), ("fundamentals_",)),
    Capability("leverage_liquidity", "Leverage, liquidity, interest coverage, debt maturities",
               r"interest coverage|debt maturity|maturity schedule|liquidity|leverage",
               ("coverage", "maturity", "liquidity", "leverage", "debt", "solvency"), ("fundamentals_",)),
    Capability("wacc", "Cost of capital (WACC / CAPM)", r"\bwacc\b|cost of capital|discount rates?",
               ("wacc", "cost of capital", "capm", "discount rate", "cost of equity"), ("valuation_",)),
    Capability("dcf", "Discounted cash flow valuation", r"discounted cash flow|\bdcf\b|intrinsic value|three-stage",
               ("dcf", "discounted cash flow", "intrinsic", "intrinsic value", "fcff"), ("valuation_",)),
    Capability("reverse_dcf", "Reverse DCF / market-implied expectations",
               r"reverse dcf|market[- ]implied|implied (growth|expectations)|justify its current",
               ("reverse", "implied", "reverse dcf", "market implied"), ("valuation_",)),
    Capability("sensitivity", "Sensitivity analysis", r"sensitivity|matrix",
               ("sensitivity", "matrix", "grid"), ("valuation_", "quant_")),
    Capability("multiples", "Relative valuation multiples (EV/EBITDA, P/E, FCF yield)",
               r"ev/ebitda|enterprise value|forward p/e|p/e\b|fcf yield|free cash flow yield|peer valuation|"
               r"valuation ranking|multiples",
               ("multiples", "ev/ebitda", "ebitda", "peers", "peer", "comparables", "fcf yield", "relative",
                "p/e"), ("valuation_",)),
    Capability("monte_carlo", "Monte Carlo simulation", r"monte carlo|simulations?",
               ("monte", "carlo", "monte carlo", "simulation", "simulations", "probabilistic", "stochastic"),
               ("valuation_", "quant_")),
    Capability("scenarios", "Scenario / stress analysis",
               r"scenarios?|stress|bull|bear|downside|shock|tariffs?|export restrictions?|geopolitical|"
               r"appreciation of the us dollar|correction",
               ("scenario", "scenarios", "stress", "shock", "bull", "bear", "what-if"), ("valuation_", "quant_")),
    Capability("volatility_regime", "Volatility, Hurst exponent, autocorrelation, regimes",
               r"volatility|hurst|autocorrelation|regime|mean reversion|momentum",
               ("volatility", "hurst", "autocorrelation", "regime", "rolling", "mean reversion"), ("quant_",)),
    Capability("risk_metrics", "Risk metrics (beta, alpha, Sharpe, Sortino, drawdown, VaR)",
               r"\bbeta\b|alpha|sharpe|sortino|drawdown|value at risk|\bvar\b",
               ("beta", "sharpe", "sortino", "drawdown", "var", "value at risk", "alpha", "risk metrics"), ("quant_",)),
    Capability("event_study", "Earnings event study (abnormal returns)",
               r"event study|abnormal returns?|earnings announcements?|eps surprises?",
               ("event", "event study", "abnormal", "announcement", "surprise", "car"), ("quant_",)),
    Capability("backtest", "Strategy backtest", r"backtest|strategy|\brsi\b|moving average|buy-and-hold|slippage|out-of-sample",
               ("backtest", "strategy", "rsi", "signal", "slippage", "transaction cost"), ("quant_",)),
    Capability("portfolio", "Portfolio correlation / risk contribution",
               r"portfolio|correlations?|diversif|marginal contribution|factor concentration",
               ("portfolio", "correlation", "covariance", "diversification", "contribution", "factor"), ("quant_",)),
    Capability("macro_factors", "Rates / macro factor sensitivity",
               r"treasury|yields?\b|interest rates?|basis[- ]points?|macro|us dollar|consumer discretionary",
               ("macro", "rates", "treasury", "yield", "factor", "fred"), ("quant_", "macro_")),
    Capability("bank_rate_sensitivity", "Bank rate sensitivity (NII, deposits, AOCI, credit losses)",
               r"net interest income|deposit costs?|securities portfolio|credit losses",
               ("net interest income", "nii", "deposit", "rate sensitivity", "interest rate risk"),
               ("filings_", "fundamentals_"), query="net interest income sensitivity to interest rates"),
    Capability("filings_compare", "Cross-filing comparison (10-K / 10-Q / 8-K)",
               r"10-k|10-q|8-k|risk[- ]factor|material changes|cross-reference|filings",
               ("filings", "filing", "10-k", "risk factors", "compare", "diff", "changes", "section", "excerpt"),
               ("filings_",), computation=False, query="risk factors material changes"),
    Capability("disclosures", "Primary disclosures (notes, obligations, segments, guidance)",
               r"contractual obligations|deferred revenue|remaining performance obligations|leases?|"
               r"capital expenditure commitments|guidance|revenue recognition|customer concentration|"
               r"geographic|inventory|depreciation|segment|cloud revenue|cross-border|transaction volume|"
               r"regulatory|disclosures?",
               ("disclosure", "disclosures", "filings", "xbrl", "notes", "obligations", "segment", "footnote", "passages"),
               ("filings_", "fundamentals_"), computation=False, query="contractual obligations commitments guidance"),
    Capability("market_value", "Current market value (price, market cap)",
               r"market cap|market capitali[sz]ation|current (share )?price|current market valuation|implied valuation",
               ("quote", "price", "market cap"), (), computation=False),
    Capability("capex", "Capital intensity / capex / depreciation",
               r"capital (expenditure|intensity)|capex|depreciation burden|infrastructure invest",
               ("capex", "capital expenditure", "depreciation", "intensity", "reinvestment"), ("fundamentals_",)),
    Capability("growth_margins", "Growth and margins", r"revenue growth|gross margin|operating margin|operating leverage|margins?",
               ("growth", "margin", "margins", "revenue", "operating leverage"), ("fundamentals_",)),
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

    def public(self) -> Dict[str, Any]:
        return {"id": self.id, "need": self.need, "capability": self.capability, "status": self.status,
                "tools": self.tools, "computation": self.computation,
                "calls": [{"tool": c.tool, "args": c.args} for c in self.calls],
                "fact_ids": self.fact_ids[:12], "errors": self.errors[:3]}


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


# property name -> hint key
_ARG_ALIASES = {
    "years": "lookback_years", "lookback_years": "lookback_years", "n_years": "lookback_years",
    "history_years": "lookback_years", "lookback": "lookback_years",
    "horizon_years": "horizon_years", "forecast_years": "horizon_years", "projection_years": "horizon_years",
    "n_simulations": "n_simulations", "n_sims": "n_simulations", "simulations": "n_simulations",
    "num_simulations": "n_simulations", "n_paths": "n_simulations", "paths": "n_simulations",
    "n_events": "n_events", "quarters": "n_events", "n_quarters": "n_events", "events": "n_events",
    "windows": "windows", "event_window": "event_window", "window_days": "event_window",
    "shock_bps": "shock_bps", "rate_shock_bps": "shock_bps", "bps": "shock_bps",
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


def suggest_calls(spec: Dict[str, Any], tickers: Sequence[str], hints: Dict[str, Any],
                  cap: Capability) -> List[Dict[str, Any]]:
    """Argument sets for one tool, or [] when a required argument cannot be filled."""
    schema = spec.get("input_schema") or {}
    props: Dict[str, Any] = schema.get("properties") or {}
    required = list(schema.get("required") or [])
    base: Dict[str, Any] = {}
    for p, prop in props.items():
        key = _ARG_ALIASES.get(p)
        if key and key in hints:
            v = _coerce(hints[key], prop)
            if v is not None:
                base[p] = v
        elif p == "query":
            base[p] = cap.query or cap.label
    tk = next((k for k in _TICKERS_KEYS if k in props), None)
    t1 = next((k for k in _TICKER_KEYS if k in props), None)
    out: List[Dict[str, Any]] = []
    if tk:
        mx = (props[tk].get("maxItems") or 10)
        mn = (props[tk].get("minItems") or 1)
        if len(tickers) >= mn:
            out.append({**base, tk: list(tickers)[:mx]})
    elif t1:
        out.extend({**base, t1: t} for t in tickers)
    else:
        out.append(dict(base))
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
    for cap in CAPABILITIES:
        if not re.search(cap.pattern, question or "", re.I):
            continue
        tools = discover_tools(cap, specs)
        step = PlanStep(id=f"S{len(plan.steps) + 1}", capability=cap.key, need=cap.label,
                        computation=cap.computation, tools=[t["name"] for t in tools])
        if not tools:
            step.status = "unavailable"
            step.errors.append("no registered tool performs this computation")
        elif all(t in PACK_COVERED for t in step.tools):
            step.status = "in_context"
        else:
            for t in tools:
                if t["name"] in PACK_COVERED:
                    continue
                for args in suggest_calls(t, tickers, hints, cap):
                    if n_prefetch >= DEEP_PREFETCH_MAX:
                        break
                    if any(c.tool == t["name"] and c.args == args for s in plan.steps for c in s.calls):
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


def plan_dict(plan: Plan) -> Dict[str, Any]:
    return asdict(plan)
