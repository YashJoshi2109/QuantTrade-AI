"""Server-side ticker resolution for the copilot.

Order of precedence:
  1. explicit ``symbol`` from the UI (Research -> Copilot handoff) — always primary
  2. ``$TSLA`` cashtags
  3. bare uppercase tickers incl. share classes (BRK.B / BRK-B / BRK/B)
  4. curated company aliases ("Alphabet" -> GOOGL, "Berkshire" -> BRK.B)
  5. capitalised company names matched against symbols.name on word boundaries
  6. conversation memory (follow-ups like "what about its margins?")

Every resolved ticker carries an identity status: tickers that were reassigned
after a delisting/merger (PARA -> Skydance/PSKY) or whose listed name disagrees
with the SEC filer are flagged so the answer does not present another
company's data (or a stale price) as current.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.symbol import Symbol
from app.services.copilot.models import Identity
from app.services.copilot.vocab import BLOCKED_AS_COMPANY_NAME, FINANCE_VOCAB_STOP, STOP_WORDS
from app.services.instrument_identity import KNOWN_TICKER_CHANGES, identity_check
from app.services.ticker_validation import classify_asset_type

MAX_TICKERS = 3

# Uppercase tokens that are finance/English acronyms, never tickers in a question.
ACRONYMS = {
    "A", "I", "AI", "CEO", "CFO", "COO", "CTO", "EPS", "PE", "P/E", "EV", "EBIT", "EBITDA",
    "FCF", "ROE", "ROA", "ROI", "ROIC", "YOY", "QOQ", "TTM", "FY", "Q", "ETF", "ETFS", "SEC",
    "GDP", "CPI", "PPI", "PCE", "FOMC", "FED", "US", "USA", "USD", "EU", "UK", "IPO", "M&A",
    "ATH", "ATL", "RSI", "MACD", "SMA", "EMA", "VWAP", "IV", "OTM", "ITM", "ATM", "DCF",
    "NAV", "AUM", "API", "LLM", "OK", "VS", "VS.", "NOT", "AND", "OR", "THE", "IS", "IT",
    "MY", "ME", "WHAT", "HOW", "WHY", "WHO", "WHEN", "DO", "DOES", "BUY", "SELL", "HOLD",
    "NYSE", "NASDAQ", "SP", "S&P", "YTD", "MTD", "Q1", "Q2", "Q3", "Q4", "H1", "H2", "TL", "DR",
    "TLDR", "FAQ", "PDF", "CEOS", "AGI", "GPU", "CPU", "EV/EBITDA", "NII", "NIM", "SYSTEM",
    "OPEX", "CAPEX", "R&D", "SG&A", "COGS", "GAAP", "IRS", "FDA", "DOJ", "FTC",
}

# Curated aliases: common names that a naive LIKE match gets wrong.
ALIASES = {
    "alphabet": "GOOGL", "google": "GOOGL", "facebook": "META", "meta": "META",
    "berkshire": "BRK.B", "berkshire hathaway": "BRK.B", "walmart": "WMT", "costco": "COST",
    "tesla": "TSLA", "nvidia": "NVDA", "microsoft": "MSFT", "apple": "AAPL", "amazon": "AMZN",
    "eli lilly": "LLY", "lilly": "LLY", "jpmorgan": "JPM", "jp morgan": "JPM", "netflix": "NFLX",
    "paramount": "PARA", "coca-cola": "KO", "coca cola": "KO", "coke": "KO", "intel": "INTC",
    "broadcom": "AVGO", "oracle": "ORCL", "salesforce": "CRM", "palantir": "PLTR", "sofi": "SOFI",
    "advanced micro devices": "AMD", "disney": "DIS", "boeing": "BA", "coinbase": "COIN",
}

_CASHTAG = re.compile(r"\$([A-Za-z]{1,6}(?:[.\-/][A-Za-z]{1,2})?)\b")
_UPPER = re.compile(r"(?<![\w$])([A-Z]{1,6}(?:[.\-/][A-Z]{1,2})?)(?![\w])")
_CAPITALISED = re.compile(r"\b([A-Z][a-zA-Z&\-]{2,}(?:\s+[A-Z][a-zA-Z&\-]+){0,2})")
_FOLLOWUP = re.compile(r"\b(it|its|it's|they|their|them|this stock|that stock|the company|this company|same)\b", re.I)

FINANCE_HINTS = re.compile(
    r"\b(stock|stocks|share|shares|price|market|earn|revenue|margin|profit|valuation|p/?e|eps|"
    r"dividend|forecast|invest|portfolio|etf|fund|bond|yield|rate|rates|inflation|cpi|fed|gdp|"
    r"sector|capex|guidance|10-?k|10-?q|8-?k|filing|risk|debt|cash|growth|analyst|buy|sell|"
    r"bull|bear|volatil|option|calls?|puts?|trading|ticker|crypto|bank|economy|recession|"
    r"losers?|gainers?|movers?|cap|nasdaq|s&p|dow|index|quarter|annual|fiscal|balance sheet|"
    r"income|ratio|technical|rsi|macd|news|outlook|compare|vs\.?|versus)\b", re.I)


def normalize_symbol(raw: str) -> str:
    """'$brk-b' -> 'BRK.B';  'BRK/B' -> 'BRK.B';  ' aapl ' -> 'AAPL'."""
    s = (raw or "").strip().lstrip("$").upper()
    s = re.sub(r"[\-/](?=[A-Z]{1,2}$)", ".", s)
    return s


def _variants(sym: str) -> List[str]:
    out = [sym]
    if "." in sym:
        a, b = sym.split(".", 1)
        out += [f"{a}-{b}", f"{a}/{b}", a + b]
    return out


@dataclass
class ResolvedTicker:
    symbol: str
    name: Optional[str] = None
    asset_type: str = "equity"
    source: str = "ticker"        # explicit | cashtag | ticker | alias | name | memory
    identity: Identity = field(default_factory=Identity)


@dataclass
class Resolution:
    tickers: List[ResolvedTicker] = field(default_factory=list)
    unknown: List[str] = field(default_factory=list)
    finance_related: bool = True

    @property
    def symbols(self) -> List[str]:
        return [t.symbol for t in self.tickers]

    @property
    def primary(self) -> Optional[ResolvedTicker]:
        return self.tickers[0] if self.tickers else None


class TickerResolver:
    def __init__(self, db: Session):
        self.db = db

    # ── DB lookups ───────────────────────────────────────────────────────────
    def lookup(self, raw: str) -> Optional[Symbol]:
        sym = normalize_symbol(raw)
        if not sym:
            return None
        return (self.db.query(Symbol)
                .filter(func.upper(Symbol.symbol).in_(_variants(sym)))
                .first())

    def _by_name(self, phrase: str) -> Optional[Symbol]:
        p = phrase.strip()
        if len(p) < 3 or p.lower() in BLOCKED_AS_COMPANY_NAME:
            return None
        q = self.db.query(Symbol).filter(
            (Symbol.name.ilike(f"{p} %")) | (Symbol.name.ilike(p)) | (Symbol.name.ilike(f"{p},%")))
        return q.order_by(Symbol.market_cap.desc().nullslast()).first()

    def _filer_name(self, symbol_id: int) -> Optional[str]:
        try:
            from app.models.edgar import CompanyEDGAR
            row = self.db.query(CompanyEDGAR.company_name).filter(
                CompanyEDGAR.symbol_id == symbol_id).first()
            return row[0] if row else None
        except Exception:
            return None

    def _make(self, row: Optional[Symbol], symbol: str, source: str) -> ResolvedTicker:
        sym = (row.symbol.upper() if row is not None else symbol)
        name = row.name if row is not None else None
        rt = ResolvedTicker(symbol=sym, name=name, source=source,
                            asset_type=classify_asset_type(sym, row.asset_type if row is not None else None))
        rt.identity = self.identity(sym, name, row.id if row is not None else None)
        return rt

    def identity(self, sym: str, listed_name: Optional[str], symbol_id: Optional[int]) -> Identity:
        known = KNOWN_TICKER_CHANGES.get(sym)
        if known:
            return Identity(status="changed", note=known["note"], former_name=known["former_name"],
                            successor_symbol=known["successor"])
        if symbol_id is not None:
            chk = identity_check(sym, listed_name, self._filer_name(symbol_id))
            if chk.get("identity_status") == "mismatch":
                return Identity(status="mismatch", note=chk.get("identity_note"),
                                former_name=chk.get("former_name"),
                                successor_symbol=chk.get("successor_symbol"))
        return Identity()

    # ── main entry ───────────────────────────────────────────────────────────
    def resolve(self, message: str, explicit_symbol: Optional[str] = None,
                memory_symbols: Sequence[str] = ()) -> Resolution:
        res = Resolution()
        seen: set[str] = set()
        msg = message or ""

        def add(rt: ResolvedTicker) -> None:
            if rt.symbol not in seen and len(res.tickers) < MAX_TICKERS:
                seen.add(rt.symbol)
                res.tickers.append(rt)

        if explicit_symbol and explicit_symbol.strip():
            row = self.lookup(explicit_symbol)
            if row is not None:
                add(self._make(row, normalize_symbol(explicit_symbol), "explicit"))
            else:
                res.unknown.append(normalize_symbol(explicit_symbol))

        for tok in _CASHTAG.findall(msg):
            row = self.lookup(tok)
            if row is not None:
                add(self._make(row, normalize_symbol(tok), "cashtag"))
            elif normalize_symbol(tok) not in res.unknown:
                res.unknown.append(normalize_symbol(tok))

        words = re.findall(r"[A-Za-z]+", msg)
        shouting = words and sum(w.isupper() for w in words) / len(words) > 0.6
        for tok in _UPPER.findall(msg):
            norm = normalize_symbol(tok)
            if norm in seen or norm in ACRONYMS or tok in ACRONYMS:
                continue
            if len(norm) < 2 or norm.lower() in STOP_WORDS or norm.lower() in FINANCE_VOCAB_STOP:
                continue
            row = self.lookup(norm)
            if row is not None:
                add(self._make(row, norm, "ticker"))
            elif not shouting and 2 <= len(norm.replace(".", "")) <= 5 and norm not in res.unknown:
                res.unknown.append(norm)

        lower = msg.lower()
        for alias in sorted(ALIASES, key=len, reverse=True):
            if re.search(rf"\b{re.escape(alias)}\b", lower):
                sym = ALIASES[alias]
                if sym in seen:
                    continue
                row = self.lookup(sym)
                add(self._make(row, sym, "alias"))

        for phrase in _CAPITALISED.findall(msg):
            first = phrase.split()[0].lower()
            if first in BLOCKED_AS_COMPANY_NAME or first in STOP_WORDS or phrase.lower() in ALIASES:
                continue
            for cand in (phrase, phrase.split()[0]):
                row = self._by_name(re.sub(r"'s$", "", cand))
                if row is not None and row.symbol.upper() not in seen:
                    add(self._make(row, row.symbol.upper(), "name"))
                    break

        # Resolved tickers explain the "unknown" uppercase tokens they came from.
        res.unknown = [u for u in res.unknown if u not in seen]

        if not res.tickers and memory_symbols and (_FOLLOWUP.search(msg) or FINANCE_HINTS.search(msg)):
            for s in memory_symbols[:MAX_TICKERS]:
                row = self.lookup(s)
                add(self._make(row, normalize_symbol(s), "memory"))

        res.finance_related = bool(res.tickers or res.unknown or FINANCE_HINTS.search(msg))
        return res


def resolve(db: Session, message: str, explicit_symbol: Optional[str] = None,
            memory_symbols: Iterable[str] = ()) -> Resolution:
    return TickerResolver(db).resolve(message, explicit_symbol, list(memory_symbols))
