"""
Portfolio ledger: the transaction list is the source of truth.

Holdings, cost basis, realized P&L, dividend income and cash are always
derived by replaying a portfolio's transactions in date order (average-cost
method). Nothing here touches the network or a broker: it is pure arithmetic
over rows, so it is safe to unit-test and impossible to place a real order.

Two portfolio kinds share the ledger:
  * tracked - the user records trades they made elsewhere (any past date,
    their own fill price). Cash is not modelled.
  * paper   - simulated trading. Starts with virtual cash; orders fill at the
    server-side last price (see app.api.portfolios). Cash cannot go negative.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Iterable, List, Optional

# Quantities below this are treated as zero (float dust after partial sells).
QTY_EPS = 1e-9

KIND_TRACKED = "tracked"
KIND_PAPER = "paper"


class LedgerError(ValueError):
    """The transaction list is internally inconsistent (e.g. selling shares
    that were never bought, or a paper portfolio spending cash it does not have)."""


@dataclass
class LedgerTxn:
    id: Optional[int]
    symbol: str
    type: str  # BUY | SELL | DIVIDEND
    quantity: float
    price: float
    fees: float
    date: datetime
    amount: float = 0.0  # DIVIDEND cash amount


@dataclass
class Lot:
    symbol: str
    quantity: float = 0.0
    cost: float = 0.0  # total cost basis of the open quantity, fees included
    realized_pnl: float = 0.0
    dividends: float = 0.0

    @property
    def avg_cost(self) -> float:
        return self.cost / self.quantity if self.quantity > QTY_EPS else 0.0


@dataclass
class LedgerState:
    lots: Dict[str, Lot] = field(default_factory=dict)
    cash: float = 0.0
    realized_pnl: float = 0.0
    dividends: float = 0.0
    fees: float = 0.0
    # realized P&L of each SELL, keyed by transaction id (None ids skipped)
    sell_pnl: Dict[int, float] = field(default_factory=dict)

    def open_lots(self) -> List[Lot]:
        return [lot for lot in self.lots.values() if lot.quantity > QTY_EPS]


def _sort_key(t: LedgerTxn):
    # Same-timestamp rows keep insertion order (ids ascend); unsaved rows last.
    return (t.date, t.id if t.id is not None else float("inf"))


def replay(
    txns: Iterable[LedgerTxn],
    *,
    starting_cash: float = 0.0,
    enforce_cash: bool = False,
) -> LedgerState:
    """Replay transactions oldest-first. Raises LedgerError on an impossible ledger."""
    state = LedgerState(cash=starting_cash)
    for t in sorted(txns, key=_sort_key):
        lot = state.lots.setdefault(t.symbol, Lot(symbol=t.symbol))
        fees = t.fees or 0.0
        if t.type == "BUY":
            spend = t.quantity * t.price + fees
            if enforce_cash and spend > state.cash + 1e-6:
                raise LedgerError(
                    f"Insufficient buying power: order costs ${spend:,.2f}, cash is ${state.cash:,.2f}"
                )
            lot.quantity += t.quantity
            lot.cost += spend
            state.cash -= spend
            state.fees += fees
        elif t.type == "SELL":
            if t.quantity > lot.quantity + QTY_EPS:
                raise LedgerError(
                    f"Cannot sell {t.quantity:g} {t.symbol}: only {max(lot.quantity, 0):g} held on "
                    f"{t.date.date().isoformat()}"
                )
            qty = min(t.quantity, lot.quantity)
            cost_out = lot.avg_cost * qty
            proceeds = qty * t.price - fees
            pnl = proceeds - cost_out
            lot.quantity -= qty
            lot.cost -= cost_out
            if lot.quantity <= QTY_EPS:
                lot.quantity = 0.0
                lot.cost = 0.0
            lot.realized_pnl += pnl
            state.realized_pnl += pnl
            state.cash += proceeds
            state.fees += fees
            if t.id is not None:
                state.sell_pnl[t.id] = pnl
        elif t.type == "DIVIDEND":
            lot.dividends += t.amount
            state.dividends += t.amount
            state.cash += t.amount
        else:
            raise LedgerError(f"Unsupported transaction type {t.type!r}")
    return state


@dataclass
class Quote:
    price: Optional[float]
    change_percent: Optional[float] = None
    previous_close: Optional[float] = None


def _r(x: Optional[float], nd: int = 2) -> Optional[float]:
    return None if x is None else round(x, nd)


def summarize(
    state: LedgerState,
    quotes: Dict[str, Quote],
    *,
    kind: str,
    starting_cash: float,
    sectors: Optional[Dict[str, Optional[str]]] = None,
    names: Optional[Dict[str, Optional[str]]] = None,
) -> dict:
    """Mark open lots to market and build the API summary payload.

    A holding with no available quote is reported with null price fields and
    excluded from market value (never valued at a made-up price); `stale_quotes`
    lists those symbols so the UI can say so.
    """
    sectors = sectors or {}
    names = names or {}
    holdings = []
    market_value = 0.0
    cost_priced = 0.0
    open_cost = 0.0
    day_change = 0.0
    stale: List[str] = []

    for lot in sorted(state.open_lots(), key=lambda l: l.symbol):
        q = quotes.get(lot.symbol) or Quote(price=None)
        open_cost += lot.cost
        price = q.price if (q.price and q.price > 0) else None
        mv = upnl = upnl_pct = dchg = None
        if price is not None:
            mv = lot.quantity * price
            upnl = mv - lot.cost
            upnl_pct = (upnl / lot.cost * 100.0) if lot.cost > 0 else None
            market_value += mv
            cost_priced += lot.cost
            if q.previous_close and q.previous_close > 0:
                dchg = (price - q.previous_close) * lot.quantity
            elif q.change_percent is not None:
                prev = price / (1 + q.change_percent / 100.0)
                dchg = (price - prev) * lot.quantity
            if dchg is not None:
                day_change += dchg
        else:
            stale.append(lot.symbol)
        holdings.append({
            "symbol": lot.symbol,
            "name": names.get(lot.symbol),
            "sector": sectors.get(lot.symbol) or "Other",
            "quantity": round(lot.quantity, 6),
            "avg_cost": _r(lot.avg_cost, 4),
            "cost_basis": _r(lot.cost),
            "price": _r(price, 4),
            "change_percent": _r(q.change_percent) if price is not None else None,
            "market_value": _r(mv),
            "unrealized_pnl": _r(upnl),
            "unrealized_pnl_percent": _r(upnl_pct),
            "day_change": _r(dchg),
            "realized_pnl": _r(lot.realized_pnl),
            "dividends": _r(lot.dividends),
            "weight": None,
        })

    is_paper = kind == KIND_PAPER
    cash = state.cash if is_paper else 0.0
    total_value = market_value + cash
    for h in holdings:
        if h["market_value"] is not None and total_value > 0:
            h["weight"] = round(h["market_value"] / total_value * 100.0, 2)

    alloc: Dict[str, float] = {}
    for h in holdings:
        if h["market_value"] is not None:
            alloc[h["sector"]] = alloc.get(h["sector"], 0.0) + h["market_value"]
    if is_paper and cash > 0.005:
        alloc["Cash"] = cash
    allocation = [
        {"label": k, "value": round(v, 2),
         "weight": round(v / total_value * 100.0, 2) if total_value > 0 else 0.0}
        for k, v in sorted(alloc.items(), key=lambda kv: -kv[1])
    ]

    unrealized = market_value - cost_priced
    total_pnl = unrealized + state.realized_pnl + state.dividends
    if is_paper:
        total_return_pct = ((total_value - starting_cash) / starting_cash * 100.0) if starting_cash > 0 else None
    else:
        total_return_pct = (unrealized / cost_priced * 100.0) if cost_priced > 0 else None
    prev_value = total_value - day_change
    day_change_pct = (day_change / prev_value * 100.0) if prev_value > 0 and day_change else 0.0

    return {
        "kind": kind,
        "simulated": is_paper,
        "starting_cash": _r(starting_cash) if is_paper else None,
        "cash": _r(cash) if is_paper else None,
        "market_value": _r(market_value),
        "total_value": _r(total_value),
        "cost_basis": _r(open_cost),
        "unrealized_pnl": _r(unrealized),
        "realized_pnl": _r(state.realized_pnl),
        "dividends": _r(state.dividends),
        "fees": _r(state.fees),
        "total_pnl": _r(total_pnl),
        "total_return_percent": _r(total_return_pct),
        "day_change": _r(day_change),
        "day_change_percent": _r(day_change_pct),
        "holdings": holdings,
        "allocation": allocation,
        "stale_quotes": stale,
    }
