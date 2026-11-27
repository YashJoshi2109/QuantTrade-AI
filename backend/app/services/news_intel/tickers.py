"""
Ticker extraction: provider-supplied symbols + cashtags + exchange-tagged
symbols "(NASDAQ: AAPL)" + bare known tickers in the headline ("AMD stock
slips") + company-name / short-brand match against the symbols table
("Palantir" for "Palantir Technologies", "Exxon" for "Exxon Mobil").

Most of our feeds (Yahoo/Google RSS, wires, Finnhub general) carry no symbol
metadata, so headline matching is the only way most stories get a ticker. It
must cover how headlines actually name companies, not only legal names.

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
    "bill",
}

# Bump when extraction rules change: the worker re-tags recent stored items
# once per version so the fix also applies to what is already in the table.
TAGGER_VERSION = "3"
# Tags earlier versions added wrongly, removed on re-tag when the current
# rules no longer find them in the story (v3: "Taiwan" was TSM's short brand).
TAGGER_RETRACT = frozenset({"TSM"})

# Bare uppercase tokens in a headline that are real tickers but almost always
# mean something else (words, units, agencies, time zones).
_BARE_STOP = _NOISE | {
    "ALL", "ARE", "BALL", "BIG", "BILL", "CAN", "CASH", "CAT", "COST", "DOW", "FAST", "GEN", "HAS",
    "ICE", "KEY", "LIFE", "LOW", "NET", "NEW", "NOW", "ONE", "OPEN", "OUT", "PATH", "PLAY", "REAL",
    "SAFE", "SNOW", "TEAM", "TRUE", "WELL", "YOU", "NOT", "TOP", "WIN", "AM", "PM", "ET", "PT", "AT",
    "BE", "DE", "ED", "ES", "GO", "IR", "IT", "MA", "MO", "MS", "NO", "ON", "OR", "SO", "TV", "UN",
    "CB", "CE", "CF", "BK", "DD", "RF", "OK", "PC", "PR", "HR", "IQ", "ID", "OS", "VR", "AR", "UP",
    "ATH", "YOY", "QOQ", "TTM", "API", "NFT", "CEO", "COO", "CTO", "ADR", "REIT", "SPAC", "NATO",
    "NEWS", "LIVE", "WATCH", "MET",
}
_BARE_TOKEN = re.compile(r"(?<![A-Za-z0-9$.&\-])([A-Z]{2,5})(?:['\u2019]s)?(?![A-Za-z0-9&]|\.[A-Za-z]|-[A-Z0-9])")

# Trailing descriptor words dropped to get the short brand people write in
# headlines ("Palantir Technologies" -> "Palantir", "Rivian Automotive" ->
# "Rivian"). Only applied when the remaining brand is distinctive.
_DESCRIPTORS = {
    "technologies", "technology", "platforms", "networks", "systems", "software", "semiconductor",
    "semiconductors", "pharmaceuticals", "therapeutics", "markets", "automotive", "aerospace",
    "athletica", "laboratories", "sciences", "scientific", "wholesale", "lifesciences", "worldwide",
    "resorts", "interactive", "entertainment", "brands", "enterprise", "solutions", "analytics",
    "biosciences", "motor", "mobil", "devices",
}
# Short brands that are also everyday words / too generic to match alone.
_BRAND_STOP = _AMBIGUOUS_NAMES | {
    "advanced", "analog", "applied", "align", "charter", "digital", "discover", "home", "live",
    "super", "unity", "monster", "intuitive", "texas", "international", "constellation",
    "delta", "southwest", "citizens", "fidelity", "capital", "western",
    # Places and generic nationality words: "Taiwan Semiconductor" minus its
    # descriptor left "Taiwan", so every story mentioning Taiwan was tagged
    # TSM (kombucha exports, consumer-confidence surveys). A place is never a
    # brand on its own; such companies match on their full name or alias.
    "taiwan", "china", "chinese", "japan", "japanese", "korea", "korean", "india", "indian",
    "hong kong", "singapore", "america", "american", "americas", "united", "national", "global",
    "general", "first", "new york", "canada", "canadian", "british", "europe", "european",
    "asia", "pacific", "atlantic", "brazil", "mexico", "germany", "france", "israel", "australia",
    "north", "south", "east", "west", "northern", "southern", "eastern", "central",
}
# Headline shorthands that no suffix rule derives. Applied only when the
# symbol is in the index.
_BRAND_ALIASES = {
    "exxon": "XOM", "exxonmobil": "XOM", "jpmorgan": "JPM", "j.p. morgan": "JPM", "disney": "DIS",
    "lilly": "LLY", "eli lilly": "LLY", "berkshire": "BRK.B", "berkshire hathaway": "BRK.B",
    "google": "GOOGL", "tsmc": "TSM", "p&g": "PG", "procter": "PG", "goldman": "GS",
    "facebook": "META", "instagram": "META", "whatsapp": "META", "pepsi": "PEP", "coke": "KO",
    "supermicro": "SMCI", "super micro": "SMCI", "hynix": "SKHY", "warner bros": "WBD",
    "citi": "C", "bny": "BK", "schwab": "SCHW",
}

_SUFFIX = re.compile(
    r"[,.]?\s+(?:inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|holdings?|group|"
    r"class [a-c]|cl [a-c]|common stock|ordinary shares|n\.?v|s\.?a|ag|se|lp|l\.?p|trust|the)\.?$",
    re.I,
)


def short_brand(core: str) -> Optional[str]:
    """'Palantir Technologies' -> 'Palantir'; None when nothing distinctive remains."""
    words = core.split()
    while len(words) > 1 and words[-1].lower() in _DESCRIPTORS:
        words = words[:-1]
    brand = " ".join(words)
    if brand == core or len(brand) < 4 or brand.lower() in _BRAND_STOP:
        return None
    return brand


def _mostly_upper(title: str) -> bool:
    letters = [c for c in title if c.isalpha()]
    return len(letters) >= 12 and sum(c.isupper() for c in letters) / len(letters) > 0.6


def normalize_company_name(name: str) -> str:
    n = (name or "").strip()
    n = re.sub(r"\.com\b", "", n, flags=re.I)
    prev = None
    while prev != n:
        prev = n
        n = _SUFFIX.sub("", n).strip(" ,.")
        # "Merck & Co" / "Eli Lilly and Co" leave a dangling connector.
        n = re.sub(r"\s+(?:&|and)$", "", n, flags=re.I).strip(" ,.")
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
        best: Dict[str, tuple] = {}  # key -> (symbol, (cap, -len(name)))
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
            keys = [core.lower()]
            brand = short_brand(core)
            if brand:
                keys.append(brand.lower())
            rank = (cap or 0, -len(name or ""))
            for key in keys:
                # Several share classes share one name (GOOG/GOOGL): keep the
                # biggest; on a tie, the plain listing over "... Class C".
                if key not in best or rank > best[key][1]:
                    best[key] = (sym, rank)
        name_map = {k: v[0] for k, v in best.items()}
        for alias, sym in _BRAND_ALIASES.items():
            if sym in symbols and alias not in name_map:
                name_map[alias] = sym
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
        # Bare known tickers ("AMD stock slips", "Is PLTR a buy?"). Headline
        # only, and never in an ALL-CAPS headline where every word looks like one.
        if self.symbols and title and not _mostly_upper(title):
            for m in _BARE_TOKEN.finditer(title):
                tok = m.group(1)
                if tok in self.symbols and tok not in _BARE_STOP:
                    add(tok)
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
