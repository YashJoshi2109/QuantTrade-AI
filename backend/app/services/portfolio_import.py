"""
CSV trade import for tracked portfolios: parse and validate, no database.

Accepted columns (header row required, case and spacing ignored; aliases in
brackets): date [trade_date, trade date, settlement date, time], symbol
[ticker, security], type [action, side, transaction, transaction type],
quantity [shares, qty, units], price [fill price, price per share], fees
[fee, commission, commissions], amount [total, net amount, value], notes
[note, description, memo].

Each row becomes a BUY, SELL or DIVIDEND. Ledger-level checks (selling more
than is held on that date) run afterwards in app.api.portfolios with the same
replay used for single transactions, so an import can never put the ledger in
a state the normal form would reject.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

MAX_IMPORT_BYTES = 512 * 1024
MAX_IMPORT_ROWS = 2000
SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")

HEADER_ALIASES: Dict[str, tuple] = {
    "date": ("date", "trade_date", "tradedate", "trade date", "settlement date", "run date", "time", "datetime"),
    "symbol": ("symbol", "ticker", "security", "instrument"),
    "type": ("type", "action", "side", "transaction", "transaction type", "activity", "activity type"),
    "quantity": ("quantity", "shares", "qty", "units", "share quantity"),
    "price": ("price", "fill price", "price per share", "share price", "avg price", "execution price"),
    "fees": ("fees", "fee", "commission", "commissions", "fees & comm", "fees and commissions"),
    "amount": ("amount", "total", "net amount", "value", "proceeds", "total amount"),
    "notes": ("notes", "note", "description", "memo", "comment"),
}
TYPE_ALIASES = {
    "BUY": "BUY", "B": "BUY", "BOUGHT": "BUY", "BUY TO OPEN": "BUY", "PURCHASE": "BUY",
    "SELL": "SELL", "S": "SELL", "SOLD": "SELL", "SELL TO CLOSE": "SELL", "SALE": "SELL",
    "DIVIDEND": "DIVIDEND", "DIV": "DIVIDEND", "DIVIDENDS": "DIVIDEND", "CASH DIVIDEND": "DIVIDEND",
    "QUALIFIED DIVIDEND": "DIVIDEND", "ORDINARY DIVIDEND": "DIVIDEND",
}
DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d-%b-%Y", "%b %d, %Y", "%Y-%m-%dT%H:%M:%S")


class ImportFormatError(ValueError):
    """The file cannot be read as a trade CSV at all (no header, too big...)."""


@dataclass
class ImportRow:
    row: int  # 1-based line number in the file (header is line 1)
    date: Optional[str] = None
    symbol: Optional[str] = None
    type: Optional[str] = None
    quantity: Optional[float] = None
    price: Optional[float] = None
    fees: float = 0.0
    amount: Optional[float] = None
    notes: Optional[str] = None
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def out(self) -> dict:
        d = asdict(self)
        d["status"] = "ok" if self.ok else "error"
        return d


def _norm_header(h: str) -> str:
    return re.sub(r"\s+", " ", (h or "").strip().lower().replace("_", " ")).strip()


def map_headers(headers: List[str]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    norm = [_norm_header(h) for h in headers]
    for key, aliases in HEADER_ALIASES.items():
        al = {_norm_header(a) for a in aliases}
        for i, h in enumerate(norm):
            if h in al and key not in out:
                out[key] = i
    return out


def parse_number(raw: Optional[str]) -> Optional[float]:
    """'$1,234.50' -> 1234.5, '(12.00)' -> -12.0, '' -> None. Raises ValueError on junk."""
    if raw is None:
        return None
    s = raw.strip()
    if not s or s in ("-", "--", "—"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace("$", "").replace(",", "").replace(" ", "")
    v = float(s)
    if v != v or v in (float("inf"), float("-inf")):
        raise ValueError("not a number")
    return -v if neg else v


def parse_date(raw: Optional[str]) -> date:
    s = (raw or "").strip()
    if not s:
        raise ValueError("date is required")
    s = s.split(" as of ")[0].strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        raise ValueError(f"unrecognised date {raw!r} (use YYYY-MM-DD or MM/DD/YYYY)")


def parse_csv(text: str, *, today: Optional[date] = None) -> List[ImportRow]:
    """Parse and validate rows. Never raises for a bad row (it carries errors);
    raises ImportFormatError when the file itself is unusable."""
    if text is None or not text.strip():
        raise ImportFormatError("The file is empty")
    if len(text.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise ImportFormatError(f"File is larger than {MAX_IMPORT_BYTES // 1024} KB")
    today = today or datetime.now(timezone.utc).date()
    text = text.lstrip("﻿")
    try:
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    rows = list(reader)
    # Skip leading banner lines some brokers add before the header.
    header_idx = next((i for i, r in enumerate(rows[:10]) if {"symbol", "type"} <= set(map_headers(r))
                       or {"symbol", "quantity"} <= set(map_headers(r))), None)
    if header_idx is None:
        raise ImportFormatError("No header row found. Columns needed: date, symbol, type, quantity, price")
    cols = map_headers(rows[header_idx])
    missing = [c for c in ("date", "symbol", "type") if c not in cols]
    if missing:
        raise ImportFormatError(f"Missing column(s): {', '.join(missing)}")
    body = [(header_idx + 2 + i, r) for i, r in enumerate(rows[header_idx + 1:]) if any((c or "").strip() for c in r)]
    if not body:
        raise ImportFormatError("No trade rows under the header")
    if len(body) > MAX_IMPORT_ROWS:
        raise ImportFormatError(f"Too many rows ({len(body)}); the limit is {MAX_IMPORT_ROWS} per import")

    def cell(r: List[str], key: str) -> Optional[str]:
        i = cols.get(key)
        return r[i] if i is not None and i < len(r) else None

    out: List[ImportRow] = []
    for line, r in body:
        row = ImportRow(row=line)
        # type
        raw_type = re.sub(r"\s+", " ", (cell(r, "type") or "").strip().upper())
        row.type = TYPE_ALIASES.get(raw_type)
        if row.type is None:
            row.errors.append(f"unknown type {cell(r, 'type')!r} (use BUY, SELL or DIVIDEND)" if raw_type else "type is required")
        # symbol
        sym = (cell(r, "symbol") or "").strip().upper()
        if not sym:
            row.errors.append("symbol is required")
        elif not SYMBOL_RE.match(sym):
            row.errors.append(f"invalid symbol {sym!r}")
        row.symbol = sym or None
        # date
        try:
            d = parse_date(cell(r, "date"))
            if d > today + timedelta(days=1):
                row.errors.append("date is in the future")
            elif d < date(1970, 1, 1):
                row.errors.append("date is too far in the past")
            row.date = d.isoformat()
        except ValueError as e:
            row.errors.append(str(e))
        # numbers
        nums = {}
        for key in ("quantity", "price", "fees", "amount"):
            try:
                nums[key] = parse_number(cell(r, key))
            except ValueError:
                row.errors.append(f"{key} is not a number: {cell(r, key)!r}")
                nums[key] = None
        qty, price, fees, amount = nums["quantity"], nums["price"], nums["fees"], nums["amount"]
        fees = abs(fees) if fees is not None else 0.0
        row.fees = round(fees, 4)
        if fees > 1_000_000:
            row.errors.append("fees are too large")
        if row.type in ("BUY", "SELL"):
            qty = abs(qty) if qty is not None else None  # brokers often sign sells negative
            if not qty or qty <= 0:
                row.errors.append("quantity must be greater than 0")
            elif qty > 1_000_000_000:
                row.errors.append("quantity is too large")
            if price is None and qty and amount:
                price = abs(amount) / qty  # some exports only carry the total
                row.warnings.append("price derived from amount / quantity")
            if price is None or price <= 0:
                row.errors.append("price must be greater than 0")
            elif price > 10_000_000:
                row.errors.append("price is too large")
            row.quantity = round(qty, 6) if qty else qty
            row.price = round(price, 6) if price else price
        elif row.type == "DIVIDEND":
            amt = abs(amount) if amount is not None else None
            if not amt and qty and price:
                amt = abs(qty * price)
            if not amt or amt <= 0:
                row.errors.append("amount is required for a dividend")
            elif amt > 1_000_000_000:
                row.errors.append("amount is too large")
            row.amount = round(amt, 4) if amt else amt
            row.quantity, row.price = 0.0, 0.0
        notes = (cell(r, "notes") or "").strip()
        row.notes = notes[:500] or None
        out.append(row)
    return out


def dedupe_key(d: str, sym: str, typ: str, qty: float, price: float, amount: float) -> tuple:
    return (d, sym, typ, round(qty or 0, 6), round(price or 0, 4), round(amount or 0, 2) if typ == "DIVIDEND" else 0)
