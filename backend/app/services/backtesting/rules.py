"""Rule-based strategy specs: validation, evaluation, presets.

A strategy is an entry rule and an optional exit rule. Each rule is a group
(``all`` = AND, ``any`` = OR) of conditions or nested groups. A condition
compares two operands:

    {"left": {"indicator": "sma", "params": {"period": 50}},
     "op": "crosses_above",
     "right": {"indicator": "sma", "params": {"period": 200}}}

An operand is an indicator reference or a constant ``{"value": 30}``. Any
numeric parameter or constant can be a reference such as ``"$fast"``. It is
resolved from ``parameters`` (defaults) or from one ``param_grid``
combination during a sweep.

Evaluation is causal: the boolean at bar t uses indicator values at t and t-1
(for crosses) only.
"""
from __future__ import annotations

import itertools
import math
from typing import Any, Dict, List, Literal, Optional, Union

import numpy as np
from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.backtesting import limits as L
from app.services.backtesting.indicators import INDICATORS, IndicatorCache, window_of

Number = Union[float, int, str]
OPS = (">", "<", ">=", "<=", "crosses_above", "crosses_below")


class Operand(BaseModel):
    indicator: Optional[str] = None
    params: Dict[str, Number] = Field(default_factory=dict)
    value: Optional[Number] = None

    @model_validator(mode="after")
    def _one(self):
        if (self.indicator is None) == (self.value is None):
            raise ValueError("operand needs exactly one of 'indicator' or 'value'")
        if self.indicator is not None:
            if self.indicator not in INDICATORS:
                raise ValueError(f"unknown indicator '{self.indicator}'")
            spec = INDICATORS[self.indicator][0]
            for k in self.params:
                if k not in spec:
                    raise ValueError(f"indicator '{self.indicator}' has no parameter '{k}'")
        return self


class Condition(BaseModel):
    left: Operand
    op: Literal[">", "<", ">=", "<=", "crosses_above", "crosses_below"]
    right: Operand
    # True if the comparison held on any of the last `within` bars (this bar
    # included), e.g. "RSI crossed above 30 within 5 bars". Lets two events
    # that rarely fire on the same bar (an RSI bounce and a MACD cross) be
    # combined. 0/None = this bar only. Uses past bars only: no look-ahead.
    within: Optional[int] = Field(default=None, ge=0, le=50)


class Group(BaseModel):
    logic: Literal["all", "any"] = "all"
    rules: List[Union["Group", Condition]] = Field(min_length=1, max_length=L.MAX_CONDITIONS)


Group.model_rebuild()


def _walk(g: Group, depth: int = 1):
    if depth > L.MAX_RULE_DEPTH:
        raise ValueError(f"rules can nest at most {L.MAX_RULE_DEPTH} levels")
    for r in g.rules:
        if isinstance(r, Group):
            yield from _walk(r, depth + 1)
        else:
            yield r


class StrategySpec(BaseModel):
    symbols: List[str] = Field(min_length=1, max_length=L.MAX_SYMBOLS)
    start_date: str
    end_date: str
    benchmark: str = Field("SPY", pattern=r"^[A-Za-z0-9.\-^=]{1,15}$")
    entry: Group
    exit: Optional[Group] = None
    parameters: Dict[str, float] = Field(default_factory=dict)
    param_grid: Dict[str, List[float]] = Field(default_factory=dict)
    side: Literal["long", "short"] = "long"
    initial_capital: float = Field(10_000.0, gt=0, le=L.MAX_CAPITAL)
    commission_bps: float = Field(1.0, ge=0, le=L.MAX_COST_BPS)
    slippage_bps: float = Field(5.0, ge=0, le=L.MAX_COST_BPS)
    borrow_bps_annual: float = Field(0.0, ge=0, le=5000)
    # Annual risk-free rate in percent (e.g. 4.0 for 3-month T-bills at 4%).
    # Used for Sharpe, Sortino, alpha and rolling Sharpe. 0 keeps the old
    # rf = 0 convention.
    risk_free_rate_pct: float = Field(0.0, ge=0, le=20)
    sizing: Literal["fixed_dollar", "pct_equity", "vol_target"] = "pct_equity"
    sizing_value: float = Field(1.0, gt=0, le=L.MAX_CAPITAL)
    vol_lookback: int = Field(20, ge=5, le=252)
    max_position_weight: float = Field(1.0, gt=0, le=1.0)
    max_gross_exposure: float = Field(1.0, gt=0, le=1.0)
    stop_loss_pct: Optional[float] = Field(None, gt=0, lt=100)
    take_profit_pct: Optional[float] = Field(None, gt=0, le=1000)
    trailing_stop_pct: Optional[float] = Field(None, gt=0, lt=100)
    max_hold_bars: Optional[int] = Field(None, ge=1, le=2000)
    signal_frequency: Literal["daily", "weekly", "monthly"] = "daily"
    rebalance: Literal["none", "weekly", "monthly"] = "none"
    fractional_shares: bool = True

    @field_validator("symbols")
    @classmethod
    def _syms(cls, v):
        import re
        out = []
        for s in v:
            s = s.strip().upper()
            if not re.match(r"^[A-Z0-9.\-^=]{1,15}$", s):
                raise ValueError(f"invalid symbol {s!r}")
            if s not in out:
                out.append(s)
        return out

    @model_validator(mode="after")
    def _check(self):
        from datetime import datetime

        s = datetime.fromisoformat(self.start_date[:10])
        e = datetime.fromisoformat(self.end_date[:10])
        if s >= e:
            raise ValueError("start_date must be before end_date")
        if (e - s).days > L.MAX_YEARS * 366:
            raise ValueError(f"date range is limited to {L.MAX_YEARS} years")
        if s.year < 1970:
            raise ValueError("start_date must be 1970 or later")
        if self.sizing == "pct_equity" and self.sizing_value > 1:
            raise ValueError("pct_equity sizing_value is a fraction (0-1]")
        if self.sizing == "vol_target" and self.sizing_value > 2:
            raise ValueError("vol_target sizing_value is an annual vol, e.g. 0.15")
        n_cond = 0
        for g in (self.entry, self.exit):
            if g is None:
                continue
            n_cond += sum(1 for _ in _walk(g))
        if n_cond > L.MAX_CONDITIONS * 2:
            raise ValueError("too many conditions")
        if len(self.param_grid) > 4:
            raise ValueError("param_grid supports at most 4 parameters")
        combos = 1
        for k, vals in self.param_grid.items():
            if not 1 <= len(vals) <= L.MAX_PARAM_VALUES:
                raise ValueError(f"param_grid '{k}' needs 1-{L.MAX_PARAM_VALUES} values")
            combos *= len(vals)
        if combos > L.MAX_GRID_COMBOS:
            raise ValueError(f"param_grid has {combos} combinations; the limit is {L.MAX_GRID_COMBOS}")
        cells = len(self.symbols) * ((e - s).days / 365.25 * 252) * combos
        if cells > L.MAX_WORK_CELLS:
            raise ValueError(
                f"too much work for one run ({len(self.symbols)} symbols x {(e - s).days / 365.25:.0f} years x "
                f"{combos} parameter sets); reduce one of them")
        refs = referenced_params(self)
        missing = [r for r in refs if r not in self.parameters and r not in self.param_grid]
        if missing:
            raise ValueError(f"parameters not defined: {', '.join(sorted(missing))}")
        if self.exit is None and not (self.stop_loss_pct or self.take_profit_pct or self.trailing_stop_pct
                                      or self.max_hold_bars):
            pass  # buy-and-hold style: allowed, exits at end of period
        # every combination must resolve to valid indicator params
        for combo in grid_combos(self)[:L.MAX_GRID_COMBOS]:
            for g in (self.entry, self.exit):
                if g is not None:
                    for c in _walk(g):
                        for o in (c.left, c.right):
                            resolve_operand(o, combo)
        uses_rank = any(o.indicator == "momentum_rank" for g in (self.entry, self.exit) if g
                        for c in _walk(g) for o in (c.left, c.right))
        if uses_rank and len(self.symbols) < 2:
            raise ValueError("momentum_rank needs at least 2 symbols")
        return self


def referenced_params(spec: StrategySpec) -> set:
    refs = set()
    for g in (spec.entry, spec.exit):
        if g is None:
            continue
        for c in _walk(g):
            for o in (c.left, c.right):
                vals = list(o.params.values()) + ([o.value] if o.value is not None else [])
                for v in vals:
                    if isinstance(v, str):
                        if not v.startswith("$") or len(v) < 2:
                            raise ValueError(f"parameter reference must look like '$name', got {v!r}")
                        refs.add(v[1:])
    return refs


def grid_combos(spec: StrategySpec) -> List[Dict[str, float]]:
    base = dict(spec.parameters)
    if not spec.param_grid:
        return [base]
    keys = sorted(spec.param_grid)
    out = []
    for vals in itertools.product(*(spec.param_grid[k] for k in keys)):
        out.append({**base, **dict(zip(keys, vals))})
    return out


def _resolve(v: Number, combo: Dict[str, float]) -> float:
    if isinstance(v, str):
        if v[1:] not in combo:
            raise ValueError(f"parameter '{v}' is not defined")
        return float(combo[v[1:]])
    return float(v)


def resolve_operand(o: Operand, combo: Dict[str, float]) -> tuple:
    if o.value is not None:
        return ("value", _resolve(o.value, combo))
    spec = INDICATORS[o.indicator][0]
    p = {}
    for k, (kind, default, lo, hi) in spec.items():
        raw = _resolve(o.params[k], combo) if k in o.params else default
        if kind == "int":
            if raw != int(raw):
                raise ValueError(f"{o.indicator}.{k} must be an integer")
            raw = int(raw)
        if not lo <= raw <= hi:
            raise ValueError(f"{o.indicator}.{k}={raw} is outside [{lo}, {hi}]")
        p[k] = raw
    if o.indicator.startswith("macd") and p["fast"] >= p["slow"]:
        raise ValueError("MACD fast period must be shorter than slow period")
    return (o.indicator, p)


def warmup_bars(spec: StrategySpec) -> int:
    w = spec.vol_lookback + 1 if spec.sizing == "vol_target" else 1
    for combo in grid_combos(spec):
        for g in (spec.entry, spec.exit):
            if g is None:
                continue
            for c in _walk(g):
                for o in (c.left, c.right):
                    kind, p = resolve_operand(o, combo)
                    if kind != "value":
                        w = max(w, window_of(kind, p))
    return min(w + 2, L.MAX_WINDOW * 3 + 50)


def _operand_values(o: Operand, combo, cache: IndicatorCache, sym: str, n: int) -> np.ndarray:
    kind, p = resolve_operand(o, combo)
    if kind == "value":
        return np.full(n, p)
    return cache.get(sym, kind, p)


def _eval_condition(c: Condition, combo, cache, sym, n) -> np.ndarray:
    a = _operand_values(c.left, combo, cache, sym, n)
    b = _operand_values(c.right, combo, cache, sym, n)
    with np.errstate(invalid="ignore"):
        if c.op == ">":
            out = a > b
        elif c.op == "<":
            out = a < b
        elif c.op == ">=":
            out = a >= b
        elif c.op == "<=":
            out = a <= b
        else:
            # cross between the symbol's previous bar and this one
            prev_a = _prev_valid(a)
            prev_b = _prev_valid(b)
            if c.op == "crosses_above":
                out = (a > b) & (prev_a <= prev_b)
            else:
                out = (a < b) & (prev_a >= prev_b)
    out = out & np.isfinite(a) & np.isfinite(b)
    if c.within:
        import pandas as pd

        out = (pd.Series(out.astype(float)).rolling(int(c.within) + 1, min_periods=1)
               .max().to_numpy() > 0)
    return out


def _prev_valid(x: np.ndarray) -> np.ndarray:
    """Value at the previous *valid* bar (symbols can have calendar gaps)."""
    import pandas as pd

    return pd.Series(x).ffill().shift(1).to_numpy(dtype=float)


def eval_group(g: Group, combo, cache, sym, n) -> np.ndarray:
    parts = [eval_group(r, combo, cache, sym, n) if isinstance(r, Group) else _eval_condition(r, combo, cache, sym, n)
             for r in g.rules]
    out = parts[0].copy()
    for p in parts[1:]:
        out = (out & p) if g.logic == "all" else (out | p)
    return out


def build_signals(spec: StrategySpec, combo: Dict[str, float], cache: IndicatorCache):
    n = len(cache.index)
    entries, exits = {}, {}
    for s in cache.frames:
        entries[s] = eval_group(spec.entry, combo, cache, s, n)
        exits[s] = eval_group(spec.exit, combo, cache, s, n) if spec.exit is not None else np.zeros(n, dtype=bool)
    return entries, exits


def describe_group(g: Optional[Group], combo: Dict[str, float]) -> str:
    if g is None:
        return "none"

    def op_txt(o: Operand) -> str:
        kind, p = resolve_operand(o, combo)
        if kind == "value":
            return f"{p:g}"
        args = ",".join(f"{v:g}" if isinstance(v, float) else str(v) for v in p.values())
        return f"{kind.upper()}({args})" if args else kind.upper()

    parts = []
    for r in g.rules:
        if isinstance(r, Group):
            parts.append(f"({describe_group(r, combo)})")
        else:
            w = f" within {r.within} bars" if r.within else ""
            parts.append(f"{op_txt(r.left)} {r.op.replace('_', ' ')} {op_txt(r.right)}{w}")
    return (" AND " if g.logic == "all" else " OR ").join(parts)


# ── Presets ──────────────────────────────────────────────────────────────

def _ind(name, **params):
    return {"indicator": name, "params": params}


def _val(v):
    return {"value": v}


def _cond(left, op, right):
    return {"left": left, "op": op, "right": right}


PRESETS: List[Dict[str, Any]] = [
    {
        "id": "golden_cross", "name": "Golden cross", "category": "Trend",
        "description": "Long when the fast SMA crosses above the slow SMA; out on the cross back down.",
        "spec": {
            "symbols": ["SPY"],
            "parameters": {"fast": 50, "slow": 200},
            "param_grid": {"fast": [20, 50, 100], "slow": [150, 200, 250]},
            "entry": {"logic": "all", "rules": [_cond(_ind("sma", period="$fast"), "crosses_above", _ind("sma", period="$slow"))]},
            "exit": {"logic": "all", "rules": [_cond(_ind("sma", period="$fast"), "crosses_below", _ind("sma", period="$slow"))]},
        },
    },
    {
        "id": "rsi_reversion", "name": "RSI mean reversion", "category": "Mean reversion",
        "description": "Buy oversold dips in an uptrend (RSI below threshold, price above SMA 200); sell when RSI recovers.",
        "spec": {
            "symbols": ["SPY"],
            "parameters": {"rsi_len": 14, "buy_below": 30, "sell_above": 55},
            "param_grid": {"buy_below": [25, 30, 35], "sell_above": [50, 55, 65]},
            "entry": {"logic": "all", "rules": [
                _cond(_ind("rsi", period="$rsi_len"), "<", _val("$buy_below")),
                _cond(_ind("close"), ">", _ind("sma", period=200)),
            ]},
            "exit": {"logic": "any", "rules": [_cond(_ind("rsi", period="$rsi_len"), ">", _val("$sell_above"))]},
            "stop_loss_pct": 8,
        },
    },
    {
        "id": "macd_trend", "name": "MACD trend", "category": "Momentum",
        "description": "MACD line crosses above its signal while price is above the 200-day SMA.",
        "spec": {
            "symbols": ["QQQ"],
            "parameters": {"fast": 12, "slow": 26, "signal": 9},
            "param_grid": {"fast": [8, 12, 16], "slow": [26, 35]},
            "entry": {"logic": "all", "rules": [
                _cond(_ind("macd", fast="$fast", slow="$slow", signal="$signal"), "crosses_above",
                      _ind("macd_signal", fast="$fast", slow="$slow", signal="$signal")),
                _cond(_ind("close"), ">", _ind("sma", period=200)),
            ]},
            "exit": {"logic": "all", "rules": [
                _cond(_ind("macd", fast="$fast", slow="$slow", signal="$signal"), "crosses_below",
                      _ind("macd_signal", fast="$fast", slow="$slow", signal="$signal")),
            ]},
        },
    },
    {
        "id": "rsi_macd_trend", "name": "RSI + MACD with MA trend filter", "category": "Momentum",
        "description": (
            "Alpaca's RSI/MACD example bot as a daily backtest: buy when an RSI(14) bounce back "
            "above 30 and a MACD bullish cross happen within 5 bars of each other while "
            "SMA50 > SMA100 > SMA200; sell when RSI falls back from above 70 and MACD crosses "
            "down (or drops below zero) within 5 bars."
        ),
        "spec": {
            "symbols": ["TQQQ"],
            "parameters": {"rsi_len": 14, "oversold": 30, "overbought": 70,
                           "fast": 12, "slow": 26, "signal": 9},
            "param_grid": {"oversold": [25, 30, 35], "overbought": [65, 70, 75]},
            "entry": {"logic": "all", "rules": [
                {**_cond(_ind("rsi", period="$rsi_len"), "crosses_above", _val("$oversold")), "within": 5},
                {**_cond(_ind("macd", fast="$fast", slow="$slow", signal="$signal"), "crosses_above",
                         _ind("macd_signal", fast="$fast", slow="$slow", signal="$signal")), "within": 5},
                _cond(_ind("sma", period=50), ">", _ind("sma", period=100)),
                _cond(_ind("sma", period=100), ">", _ind("sma", period=200)),
            ]},
            "exit": {"logic": "all", "rules": [
                {**_cond(_ind("rsi", period="$rsi_len"), "crosses_below", _val("$overbought")), "within": 5},
                {"logic": "any", "rules": [
                    {**_cond(_ind("macd", fast="$fast", slow="$slow", signal="$signal"), "crosses_below",
                             _ind("macd_signal", fast="$fast", slow="$slow", signal="$signal")), "within": 5},
                    {**_cond(_ind("macd", fast="$fast", slow="$slow", signal="$signal"), "crosses_below",
                             _val(0)), "within": 5},
                ]},
            ]},
            "stop_loss_pct": 10,
        },
    },
    {
        "id": "bollinger_reversion", "name": "Bollinger reversion", "category": "Mean reversion",
        "description": "Buy a close below the lower band; sell at the middle band.",
        "spec": {
            "symbols": ["SPY"],
            "parameters": {"len": 20, "width": 2},
            "param_grid": {"len": [10, 20, 30], "width": [1.5, 2, 2.5]},
            "entry": {"logic": "all", "rules": [_cond(_ind("close"), "<", _ind("bb_lower", period="$len", std="$width"))]},
            "exit": {"logic": "all", "rules": [_cond(_ind("close"), ">", _ind("bb_mid", period="$len"))]},
            "stop_loss_pct": 10,
        },
    },
    {
        "id": "donchian_breakout", "name": "Donchian breakout", "category": "Breakout",
        "description": "Buy a close above the prior N-day high; exit below the prior M-day low (turtle-style).",
        "spec": {
            "symbols": ["GLD"],
            "parameters": {"entry_len": 55, "exit_len": 20},
            "param_grid": {"entry_len": [20, 55, 100], "exit_len": [10, 20, 40]},
            "entry": {"logic": "all", "rules": [_cond(_ind("close"), ">", _ind("highest", period="$entry_len"))]},
            "exit": {"logic": "all", "rules": [_cond(_ind("close"), "<", _ind("lowest", period="$exit_len"))]},
        },
    },
    {
        "id": "momentum_rotation", "name": "Momentum rotation", "category": "Multi-asset",
        "description": "Each month, hold the top K ETFs by N-day return, equal weight; rebalance monthly.",
        "spec": {
            "symbols": ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "GLD"],
            "parameters": {"lookback": 126, "top": 3},
            "param_grid": {"lookback": [63, 126, 252], "top": [2, 3, 4]},
            "entry": {"logic": "all", "rules": [
                _cond(_ind("momentum_rank", period="$lookback"), "<=", _val("$top")),
                _cond(_ind("roc", period="$lookback"), ">", _val(0)),
            ]},
            "exit": {"logic": "any", "rules": [
                _cond(_ind("momentum_rank", period="$lookback"), ">", _val("$top")),
                _cond(_ind("roc", period="$lookback"), "<", _val(0)),
            ]},
            "sizing": "pct_equity", "sizing_value": 0.33,
            "signal_frequency": "monthly", "rebalance": "monthly",
        },
    },
    {
        "id": "buy_and_hold", "name": "Buy and hold", "category": "Baseline",
        "description": "Buy on the first bar and hold. The baseline every strategy should beat after costs.",
        "spec": {
            "symbols": ["SPY"],
            "entry": {"logic": "all", "rules": [_cond(_ind("close"), ">", _val(0))]},
            "exit": None,
        },
    },
]


def is_finite_number(x) -> bool:
    try:
        return math.isfinite(float(x))
    except (TypeError, ValueError):
        return False
