"""
Ticker extraction: provider-supplied symbols + cashtags + exchange-tagged
symbols "(NASDAQ: AAPL)" + exact company-name match against the symbols table.

The symbol/name/market-cap map is loaded from the DB once and refreshed every
6 hours (blocking DB call; call `refresh()` from a worker thread).
"""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Dict, Iterable, List, Optional, Set

logger = logging.getLogger(__name__)

_CASHTAG = re.compile(r"(?<![A-Za-z0-9])\$([A-Z]{1,5}(?:\.[A-Z])?)\b")
_EXCHANGE_TAG = re.compile(
    r"\((?:NYSE|NASDAQ|Nasdaq|NYSE American|NYSE Arca|AMEX|OTC|OTCQX|OTCQB|TSX|CBOE|Cboe)\s*:\s*([A-Z]{1,5}(?:\.[A-Z])?)\)"
)
_PAREN_TICKER = re.compile(r"\(([A-Z]{1,5})\)")
_TICKER_OK = re.compile(r"^[A-Z]{1,5}(?:[.-][A-Z])?$")

# Tokens that look like tickers in parentheses but aren't.
_NOISE = {
    "CEO", "CFO", "IPO", "GDP", "ETF", "SEC", "FDA", "NYSE", "AI", "US", "UK", "EU", "FED", "CPI",
    "PPI", "AND", "THE", "FOR", "ARE", "BUT", "USD", "EPS", "Q1", "Q2", "Q3", "Q4", "FY", "ESG",
    "LLC", "INC", "LTD", "PLC", "NA", "EV", "OPEC", "FOMC", "ECB", "BOJ", "IMF", "WHO", "DOJ", "FTC",
}

# Company names that are also common English words: only matched via
# cashtag/provider symbols, never via bare name.
_AMBIGUOUS_NAMES = {
    "target", "block", "visa", "gap", "ball", "match", "snap", "square", "shell", "apollo",
    "global", "united", "american", "general", "first", "national", "public", "news",
    "progressive", "regions", "southern", "principal", "realty", "equity", "trade", "best",
    "fortune", "chase", "mosaic", "vertex", "pool", "corning", "dollar", "alliance", "federal",
}

_SUFFIX = re.compile(
    r"[,.]?\s+(?:inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|"
    r"class [a-c]|cl [a-c]|common stock|ordinary shares|n\.?v|s\.?a|ag|se|lp|l\.?p|trust|the)\.?$",
    re.I,
)


def normalize_company_name(name: str) -> str:
    n = (name or "").strip()
    n = re.sub(r"\.com\b", "", n, flags=re.I)
    prev = None
    while prev != n:
        prev = n
        n = _SUFFIX.sub("", n).strip(" ,.")
    n = re.sub(r"\s+", " ", n)
    return n


class TickerIndex:
    REFRESH_SECONDS = 6 * 3600

    def __init__(self):
        self.symbols: Set[str] = set()
        self.market_caps: Dict[str, float] = {}
        self._name_to_symbol: Dict[str, str] = {}
        self._name_rx: Optional[re.Pattern] = None
        self._loaded_at = 0.0
        self._lock = threading.Lock()

    # ── loading ──────────────────────────────────────────────────────────
    def load_rows(self, rows: Iterable[tuple]) -> None:
        """rows: (symbol, name, market_cap)."""
        symbols: Set[str] = set()
        caps: Dict[str, float] = {}
        best: Dict[str, tuple] = {}
        for sym, name, cap in rows:
            if not sym:
                continue
            sym = sym.upper().strip()
            symbols.add(sym)
            if cap:
                caps[sym] = float(cap)
            core = normalize_company_name(name or "")
            if len(core) < 3 or core.lower() in _AMBIGUOUS_NAMES:
                continue
            key = core.lower()
            # Several share classes share one name (GOOG/GOOGL): keep the biggest.
            if key not in best or (cap or 0) > (best[key][1] or 0):
                best[key] = (sym, cap)
        name_map = {k: v[0] for k, v in best.items()}
        rx = None
        if name_map:
            alts = sorted(name_map, key=len, reverse=True)
            rx = re.compile(r"(?<![\w&])(" + "|".join(re.escape(a) for a in alts) + r")(?:'s)?(?![\w&])", re.I)
        with self._lock:
            self.symbols, self.market_caps = symbols, caps
            self._name_to_symbol, self._name_rx = name_map, rx
            self._loaded_at = time.time()

    def refresh(self, force: bool = False) -> None:
        if not force and self._loaded_at and time.time() - self._loaded_at < self.REFRESH_SECONDS:
            return
        try:
            from app.db.database import SessionLocal
            from app.models.symbol import Symbol

            if SessionLocal is None:
                return
            db = SessionLocal()
            try:
                rows = db.query(Symbol.symbol, Symbol.name, Symbol.market_cap).all()
            finally:
                db.close()
            self.load_rows(rows)
            logger.info("TickerIndex loaded %d symbols, %d names", len(self.symbols), len(self._name_to_symbol))
        except Exception as e:
            logger.warning("TickerIndex refresh failed: %s", e)
            self._loaded_at = time.time() - self.REFRESH_SECONDS + 300  # retry in 5 min

    # ── extraction ───────────────────────────────────────────────────────
    def _known(self, sym: str) -> bool:
        return not self.symbols or sym in self.symbols

    def extract(self, title: str, summary: str = "", provider_symbols: Iterable[str] = (),
                limit: int = 8) -> List[str]:
        found: List[str] = []

        def add(sym: str):
            sym = (sym or "").upper().strip().lstrip("$")
            if sym and sym not in found and sym not in _NOISE and _TICKER_OK.match(sym):
                found.append(sym)

        for s in provider_symbols or ():
            # Provider tags are trusted when well-formed (they include non-US
            # and small caps missing from our symbols table).
            add(s)
        text = f"{title or ''} {summary or ''}"
        for m in _CASHTAG.finditer(text):
            add(m.group(1))
        for m in _EXCHANGE_TAG.finditer(text):
            add(m.group(1))
        for m in _PAREN_TICKER.finditer(title or ""):
            if self.symbols and m.group(1) in self.symbols:
                add(m.group(1))
        if self._name_rx is not None and title:
            for m in self._name_rx.finditer(title):
                matched = m.group(1)
                # Require the headline's own capitalisation (proper noun).
                if not matched[:1].isupper():
                    continue
                sym = self._name_to_symbol.get(matched.lower())
                if sym:
                    add(sym)
        return found[:limit]

    def market_cap(self, sym: str) -> Optional[float]:
        return self.market_caps.get(sym)


_index: Optional[TickerIndex] = None


def get_ticker_index() -> TickerIndex:
    global _index
    if _index is None:
        _index = TickerIndex()
    return _index
