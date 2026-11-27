"""Event-driven daily backtest engine with next-bar-open fills.

Timing contract (the thing every test in tests/backtesting checks):

* A strategy decision is made with data up to and including the **close of
  bar t**. It is filled at the **open of the next bar the symbol trades**
  (t+1, or later if the symbol has no bar that day). No order ever fills on
  the bar that produced it.
* Protective exits (stop-loss, take-profit, trailing stop) are resting orders
  evaluated intrabar from the bar after entry onward, plus the rest of the
  entry bar after the open fill. If the bar *opens* through the level, the
  fill is the open (a gap), never the better stop price. If one bar touches
  both the stop and the target, the stop is assumed to fill first.
* The trailing-stop reference is the highest high (lowest low for shorts) of
  bars *before* the current one. The current bar's high cannot raise the
  stop that the same bar's low then hits, because the intrabar order of the
  high and low is unknown.
* Costs: ``slippage_bps`` moves every fill against the trade;
  ``commission_bps`` is charged on the filled notional, per side.
* Equity is marked at each close. Returns are the period-over-period change
  of that one equity series, so overlapping trades are never summed.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

import numpy as np
import pandas as pd


class BacktestTimeout(Exception):
    """Raised when a run exceeds its time budget."""


@dataclass
class EngineConfig:
    initial_capital: float = 10_000.0
    commission_bps: float = 0.0
    slippage_bps: float = 0.0
    # fixed_dollar: sizing_value dollars per position
    # pct_equity:   sizing_value fraction of current equity per position
    # vol_target:   sizing_value annualised vol target per position (e.g. 0.15)
    sizing: str = "pct_equity"
    sizing_value: float = 1.0
    vol_lookback: int = 20
    max_position_weight: float = 1.0
    max_gross_exposure: float = 1.0
    side: str = "long"  # long | short
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    trailing_stop_pct: Optional[float] = None
    max_hold_bars: Optional[int] = None
    # Entry/exit decisions are taken on every bar ("daily") or only on the last
    # bar of each week / month. Stops are always live.
    signal_frequency: str = "daily"
    # Resize open positions back to target weight at period end.
    rebalance: str = "none"  # none | weekly | monthly
    fractional_shares: bool = True
    borrow_bps_annual: float = 0.0
    close_at_end: bool = True
    periods_per_year: int = 252


@dataclass
class Position:
    symbol: str
    direction: int  # +1 long, -1 short
    qty: float  # always positive
    avg_price: float
    entry_date: pd.Timestamp
    signal_date: pd.Timestamp
    entry_index: int
    entry_equity: float
    commission: float = 0.0
    borrow: float = 0.0
    realized: float = 0.0
    max_notional: float = 0.0
    ref_extreme: float = 0.0  # trailing reference (prior bars only)
    mae: float = 0.0
    mfe: float = 0.0
    bars_held: int = 0


@dataclass
class TradeRecord:
    symbol: str
    side: str
    signal_date: str
    entry_date: str
    entry_price: float
    exit_signal_date: Optional[str]
    exit_date: str
    exit_price: float
    quantity: float
    pnl: float
    return_pct: float
    commission: float
    bars_held: int
    exit_reason: str
    mae: float
    mfe: float
    entry_equity: float

    def to_dict(self) -> dict:
        r = lambda v, n=4: None if v is None else round(float(v), n)
        return {
            "symbol": self.symbol, "side": self.side,
            "signal_date": self.signal_date, "entry_date": self.entry_date,
            "entry_price": r(self.entry_price), "exit_signal_date": self.exit_signal_date,
            "exit_date": self.exit_date, "exit_price": r(self.exit_price),
            "quantity": r(self.quantity, 6), "pnl": r(self.pnl, 2), "return_pct": r(self.return_pct, 3),
            "commission": r(self.commission, 2), "bars_held": self.bars_held,
            "exit_reason": self.exit_reason, "mae": r(self.mae, 3), "mfe": r(self.mfe, 3),
            "entry_equity": r(self.entry_equity, 2),
        }


@dataclass
class EngineResult:
    equity: pd.Series
    cash: pd.Series
    gross_exposure: pd.Series  # gross position value / equity at each close
    trades: List[TradeRecord]
    open_positions: List[dict]
    traded_notional: float
    total_commission: float
    fills: List[dict] = field(default_factory=list)
    ruined: bool = False


def _period_end_mask(index: pd.DatetimeIndex, freq: str) -> np.ndarray:
    """True on the last bar of each calendar week / month (decision bars)."""
    n = len(index)
    if freq in ("daily", "none", None) or n == 0:
        return np.ones(n, dtype=bool)
    if freq == "weekly":
        key = index.isocalendar().year.values * 100 + index.isocalendar().week.values
    elif freq == "monthly":
        key = index.year * 100 + index.month
    else:
        raise ValueError(f"unknown frequency {freq}")
    key = np.asarray(key)
    mask = np.zeros(n, dtype=bool)
    mask[:-1] = key[1:] != key[:-1]
    mask[-1] = True
    return mask


def align_frames(frames: Dict[str, pd.DataFrame]) -> tuple[pd.DatetimeIndex, Dict[str, Dict[str, np.ndarray]]]:
    """Put every symbol on the union calendar. Missing bars stay NaN (not
    forward-filled), so a symbol cannot trade before it listed or after its
    data ends."""
    idx = None
    for df in frames.values():
        idx = df.index if idx is None else idx.union(df.index)
    idx = pd.DatetimeIndex(idx).sort_values()
    arrays = {}
    for sym, df in frames.items():
        d = df.reindex(idx)
        arrays[sym] = {c: d[c].to_numpy(dtype=float) for c in ("open", "high", "low", "close")}
    return idx, arrays


def run_engine(
    frames: Dict[str, pd.DataFrame],
    entries: Dict[str, np.ndarray],
    exits: Dict[str, np.ndarray],
    cfg: EngineConfig,
    trade_start: Optional[pd.Timestamp] = None,
    deadline: Optional[float] = None,
    clock: Optional[Callable[[], float]] = None,
    index: Optional[pd.DatetimeIndex] = None,
    arrays: Optional[Dict[str, Dict[str, np.ndarray]]] = None,
) -> EngineResult:
    """Simulate a portfolio.

    ``entries[sym][t]`` / ``exits[sym][t]`` are booleans known at the close of
    bar t (on the aligned calendar). Bars before ``trade_start`` are warm-up:
    indicators may use them, but no decision is taken there and equity starts
    at ``trade_start``.
    """
    import time as _time

    clock = clock or _time.monotonic
    if index is None or arrays is None:
        index, arrays = align_frames(frames)
    symbols = list(arrays.keys())
    n = len(index)
    start_i = 0
    if trade_start is not None:
        start_i = int(index.searchsorted(pd.Timestamp(trade_start)))
    if n == 0 or start_i >= n:
        raise ValueError("no bars inside the trading window")

    slip = cfg.slippage_bps / 1e4
    comm = cfg.commission_bps / 1e4
    direction = -1 if cfg.side == "short" else 1
    decide = _period_end_mask(index, cfg.signal_frequency)
    rebal = _period_end_mask(index, cfg.rebalance) if cfg.rebalance != "none" else np.zeros(n, dtype=bool)

    # Causal realised vol for vol-target sizing (uses closes up to t).
    vols: Dict[str, np.ndarray] = {}
    if cfg.sizing == "vol_target":
        for s in symbols:
            c = pd.Series(arrays[s]["close"]).ffill()
            lr = np.log(c).diff()
            vols[s] = (lr.rolling(cfg.vol_lookback, min_periods=cfg.vol_lookback).std() * np.sqrt(cfg.periods_per_year)).to_numpy()

    cash = float(cfg.initial_capital)
    positions: Dict[str, Position] = {}
    pending: Dict[str, dict] = {}
    blocked: Dict[str, bool] = {s: False for s in symbols}
    last_close: Dict[str, float] = {s: np.nan for s in symbols}
    trades: List[TradeRecord] = []
    fills: List[dict] = []
    traded = 0.0
    total_comm = 0.0
    ruined = False

    eq_out = np.full(n - start_i, np.nan)
    cash_out = np.full(n - start_i, np.nan)
    gross_out = np.zeros(n - start_i)
    equity_prev_close = cash

    def ds(i: int) -> str:
        return index[i].date().isoformat()

    def fill_price(raw: float, side_sign: int) -> float:
        # side_sign +1 = buying, -1 = selling; slippage is always adverse.
        return raw * (1 + slip) if side_sign > 0 else raw * (1 - slip)

    def record_fill(i, sym, action, qty, price, reason):
        fills.append({"date": ds(i), "symbol": sym, "action": action, "qty": qty, "price": price, "reason": reason})

    def close_position(i: int, sym: str, raw_price: float, reason: str, exit_signal_date: Optional[str]):
        nonlocal cash, traded, total_comm
        p = positions.pop(sym)
        px = fill_price(raw_price, -p.direction)
        notional = p.qty * px
        c = notional * comm
        cash += p.direction * notional - c
        traded += notional
        total_comm += c
        p.commission += c
        p.realized += p.direction * p.qty * (px - p.avg_price)
        pnl = p.realized - p.commission - p.borrow
        base = p.max_notional if p.max_notional > 0 else p.qty * p.avg_price
        trades.append(TradeRecord(
            symbol=sym, side="LONG" if p.direction > 0 else "SHORT",
            signal_date=p.signal_date.date().isoformat(), entry_date=p.entry_date.date().isoformat(),
            entry_price=p.avg_price, exit_signal_date=exit_signal_date, exit_date=ds(i), exit_price=px,
            quantity=p.qty, pnl=pnl, return_pct=pnl / base * 100 if base else 0.0, commission=p.commission,
            bars_held=p.bars_held, exit_reason=reason, mae=p.mae, mfe=p.mfe, entry_equity=p.entry_equity,
        ))
        record_fill(i, sym, "exit", p.qty, px, reason)

    def adjust_qty(i: int, sym: str, target_qty: float, raw_price: float):
        """Resize an open position (rebalance)."""
        nonlocal cash, traded, total_comm
        p = positions[sym]
        delta = target_qty - p.qty
        if abs(delta) * raw_price < 1e-6:
            return
        if delta > 0:  # add
            px = fill_price(raw_price, p.direction)
            if p.direction > 0:
                delta = min(delta, max(cash, 0.0) / (px * (1 + comm)))
                if delta <= 0:
                    return
            notional = delta * px
            c = notional * comm
            cash -= p.direction * notional + c
            p.avg_price = (p.avg_price * p.qty + px * delta) / (p.qty + delta)
            p.qty += delta
        else:  # reduce
            d = -delta
            px = fill_price(raw_price, -p.direction)
            notional = d * px
            c = notional * comm
            cash += p.direction * notional - c
            p.realized += p.direction * d * (px - p.avg_price)
            p.qty -= d
        traded += notional
        total_comm += c
        p.commission += c
        p.max_notional = max(p.max_notional, p.qty * p.avg_price)
        record_fill(i, sym, "resize", p.qty, px, "rebalance")

    def target_weight(sym: str, i: int) -> float:
        if cfg.sizing == "fixed_dollar":
            w = cfg.sizing_value / equity_prev_close if equity_prev_close > 0 else 0.0
        elif cfg.sizing == "vol_target":
            v = vols[sym][i]
            if not np.isfinite(v) or v <= 0:
                return 0.0
            w = cfg.sizing_value / v
        else:
            w = cfg.sizing_value
        return float(max(0.0, min(w, cfg.max_position_weight)))

    for i in range(start_i, n):
        if deadline is not None and (i & 63) == 0 and clock() > deadline:
            raise BacktestTimeout("backtest exceeded its time budget")
        ts = index[i]

        # 1) Fill orders decided at a previous close, at this bar's open.
        if pending:
            # exits first so their cash funds entries
            for sym in [s for s, o in pending.items() if o["kind"] == "exit"]:
                o_ = arrays[sym]["open"][i]
                if np.isfinite(o_) and sym in positions:
                    close_position(i, sym, o_, pending[sym]["reason"], pending[sym]["signal_date"])
                if np.isfinite(o_):
                    pending.pop(sym)
            mark = cash + sum(p.direction * p.qty * (last_close[s] if np.isfinite(last_close[s]) else p.avg_price)
                              for s, p in positions.items())
            gross_now = sum(p.qty * (last_close[s] if np.isfinite(last_close[s]) else p.avg_price)
                            for s, p in positions.items())
            for sym in [s for s, o in pending.items() if o["kind"] in ("enter", "resize")]:
                o = pending[sym]
                o_ = arrays[sym]["open"][i]
                if not np.isfinite(o_):
                    continue  # wait for the symbol's next bar
                pending.pop(sym)
                notional_target = o["weight"] * o["equity"]
                if o["kind"] == "resize":
                    if sym in positions:
                        adjust_qty(i, sym, notional_target / o_, o_)
                    continue
                if sym in positions:
                    continue
                cap = max(0.0, cfg.max_gross_exposure * max(mark, 0.0) - gross_now)
                notional_target = min(notional_target, cap)
                px = fill_price(o_, direction)
                if direction > 0:
                    notional_target = min(notional_target, max(cash, 0.0) / (1 + comm))
                qty = notional_target / px
                if not cfg.fractional_shares:
                    qty = float(np.floor(qty))
                if qty <= 0 or qty * px < 1e-6:
                    continue
                notional = qty * px
                c = notional * comm
                cash -= direction * notional + c
                traded += notional
                total_comm += c
                gross_now += notional
                positions[sym] = Position(
                    symbol=sym, direction=direction, qty=qty, avg_price=px, entry_date=ts,
                    signal_date=o["signal_ts"], entry_index=i, entry_equity=o["equity"], commission=c,
                    max_notional=notional, ref_extreme=px,
                )
                record_fill(i, sym, "enter", qty, px, "signal")

        # 2) Resting protective orders, intrabar.
        for sym in list(positions.keys()):
            a = arrays[sym]
            o_, h, l = a["open"][i], a["high"][i], a["low"][i]
            if not np.isfinite(o_):
                continue
            p = positions[sym]
            entered_now = p.entry_index == i
            d = p.direction
            stop = tp = trail = None
            if cfg.stop_loss_pct:
                stop = p.avg_price * (1 - d * cfg.stop_loss_pct / 100)
            if cfg.take_profit_pct:
                tp = p.avg_price * (1 + d * cfg.take_profit_pct / 100)
            if cfg.trailing_stop_pct:
                trail = p.ref_extreme * (1 - d * cfg.trailing_stop_pct / 100)
            # the tighter of stop / trail is the effective protective stop
            prot, prot_reason = None, None
            for lvl, why in ((stop, "stop_loss"), (trail, "trailing_stop")):
                if lvl is None:
                    continue
                if prot is None or (d > 0 and lvl > prot) or (d < 0 and lvl < prot):
                    prot, prot_reason = lvl, why
            exit_px, why = None, None
            if not entered_now:
                if prot is not None and ((d > 0 and o_ <= prot) or (d < 0 and o_ >= prot)):
                    exit_px, why = o_, prot_reason + "_gap"
                elif tp is not None and ((d > 0 and o_ >= tp) or (d < 0 and o_ <= tp)):
                    exit_px, why = o_, "take_profit_gap"
            if exit_px is None:
                if prot is not None and ((d > 0 and l <= prot) or (d < 0 and h >= prot)):
                    exit_px, why = prot, prot_reason
                elif tp is not None and ((d > 0 and h >= tp) or (d < 0 and l <= tp)):
                    exit_px, why = tp, "take_profit"
            # MAE/MFE over the bar (relative to entry fill)
            lo_pct = (l - p.avg_price) / p.avg_price * 100 * d
            hi_pct = (h - p.avg_price) / p.avg_price * 100 * d
            p.mae = min(p.mae, lo_pct, hi_pct)
            p.mfe = max(p.mfe, lo_pct, hi_pct)
            if exit_px is not None:
                p.bars_held += 1
                close_position(i, sym, exit_px, why, None)
                pending.pop(sym, None)
                blocked[sym] = True
                continue
            # update trailing reference only after this bar's check
            p.ref_extreme = max(p.ref_extreme, h) if d > 0 else min(p.ref_extreme, l)

        # 3) Mark to market at the close; accrue borrow on shorts.
        for sym in symbols:
            c_ = arrays[sym]["close"][i]
            if np.isfinite(c_):
                last_close[sym] = c_
        gross = 0.0
        pos_val = 0.0
        for sym, p in positions.items():
            px = last_close[sym]
            if arrays[sym]["close"][i] == arrays[sym]["close"][i]:  # traded today
                p.bars_held += 1
            if p.direction < 0 and cfg.borrow_bps_annual:
                fee = p.qty * px * cfg.borrow_bps_annual / 1e4 / cfg.periods_per_year
                cash -= fee
                p.borrow += fee
            pos_val += p.direction * p.qty * px
            gross += p.qty * px
        equity = cash + pos_val
        if equity <= 0 and not ruined:
            ruined = True
            for sym in list(positions.keys()):
                close_position(i, sym, last_close[sym], "ruin", ds(i))
            pending.clear()
            equity = cash
            gross = 0.0
        k = i - start_i
        eq_out[k] = equity
        cash_out[k] = cash
        gross_out[k] = gross / equity if equity > 0 else 0.0
        equity_prev_close = equity

        # 4) Decisions at this close, filled at the next open.
        if i == n - 1 or ruined:
            continue
        for sym in symbols:
            if not np.isfinite(arrays[sym]["close"][i]):
                continue
            ent = bool(entries[sym][i]) if entries.get(sym) is not None else False
            ext = bool(exits[sym][i]) if exits.get(sym) is not None else False
            if sym in positions:
                p = positions[sym]
                hold_out = cfg.max_hold_bars is not None and p.bars_held >= cfg.max_hold_bars
                if (decide[i] and ext) or hold_out:
                    pending[sym] = {"kind": "exit", "reason": "max_hold" if hold_out and not ext else "signal",
                                    "signal_date": ds(i)}
                elif rebal[i]:
                    w = target_weight(sym, i)
                    if w > 0:
                        pending[sym] = {"kind": "resize", "weight": w, "equity": equity, "signal_ts": ts}
            elif decide[i]:
                if not ent:
                    blocked[sym] = False
                elif not blocked[sym] and sym not in pending:
                    w = target_weight(sym, i)
                    if w > 0:
                        pending[sym] = {"kind": "enter", "weight": w, "equity": equity, "signal_ts": ts}

    # End of window: open orders lapse; optionally liquidate at the last close.
    open_pos = []
    if cfg.close_at_end and positions:
        for sym in list(positions.keys()):
            close_position(n - 1, sym, last_close[sym], "end_of_period", None)
        eq_out[-1] = cash
        cash_out[-1] = cash
        # gross_out[-1] keeps the exposure marked at that close: the position
        # was held through the last bar and only liquidated at its close.
        # Zeroing it under-stated exposure by one bar (SPY 1y buy-and-hold
        # showed 99.21% instead of 99.60%).
    else:
        for sym, p in positions.items():
            open_pos.append({"symbol": sym, "side": "LONG" if p.direction > 0 else "SHORT", "quantity": p.qty,
                             "entry_date": p.entry_date.date().isoformat(), "entry_price": p.avg_price,
                             "last_price": last_close[sym]})

    idx = index[start_i:]
    return EngineResult(
        equity=pd.Series(eq_out, index=idx), cash=pd.Series(cash_out, index=idx),
        gross_exposure=pd.Series(gross_out, index=idx), trades=trades, open_positions=open_pos,
        traded_notional=traded, total_commission=total_comm, fills=fills, ruined=ruined,
    )
