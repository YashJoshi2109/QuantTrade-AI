"""Ticker universe audit: is every ticker we list still the company we think,
and does it still trade?

For each ticker it gathers evidence from our own providers and public data:

* SEC company_tickers.json (who holds the ticker today) and
  ``ticker_lifecycle.RETIREMENTS`` (audited renames / acquisitions / reuse);
* daily bars: Alpaca SIP (``alpaca_client.get_daily_bars_sip``, when keys are
  configured), yfinance history, and optionally prod's public
  ``/api/v1/prices/{t}``;
* the canonical quote (``QuoteCacheService`` when a DB is configured, or prod's
  public ``/api/v1/enhanced/quote/{t}``);

and ``classify`` (pure, unit-tested) returns one of

    ok | stale | renamed | acquired_or_delisted | reused | unknown

plus a name-consistency flag (our displayed name vs SEC's holder).
``completeness`` scores a ticker's Research page fields from prod's API.

Inventory: ``CODE_SOURCES`` lists every curated ticker list in the repo
(backend + frontend); ``collect_code_universe`` extracts them without importing
the modules (AST / regex), so it runs anywhere.

Usage (local, public data only)::

    cd backend && python scripts/audit_ticker_universe.py --prod-api https://www.quanttrade.us \
        --markdown ../docs/TICKER_AUDIT.md

In the prod container (``scripts/`` is not shipped; this module is)::

    python -m app.services.ticker_audit --db --prod-api http://localhost:8000      # report
    python -m app.services.ticker_audit --db --apply --allow-production            # + mark inactive

``--apply`` only writes ``symbols`` lifecycle columns for audited retirements
(``ticker_lifecycle.apply_retirements``) and for tickers classified
acquired_or_delisted with no bars for 30+ sessions; it never deletes rows.
"""
from __future__ import annotations

import argparse
import ast
import json
import logging
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

logger = logging.getLogger(__name__)

OK = "ok"
STALE = "stale"
RENAMED = "renamed"
GONE = "acquired_or_delisted"
REUSED = "reused"
UNKNOWN = "unknown"
CLASSES = (OK, STALE, RENAMED, GONE, REUSED, UNKNOWN)

STALE_SESSIONS = 10

FOREIGN_SUFFIXES = ("NS", "BO", "L", "T", "HK", "DE", "PA", "TO", "SS", "SZ", "KS", "AX", "SA", "SW", "AS", "JO",
                    "NZ", "MI", "MC", "ST", "CO", "OL", "HE", "BR", "VI", "SI", "TW", "IS", "MX", "V")
_SUFFIX_RE = "|".join(FOREIGN_SUFFIXES)
TICKER_RE = re.compile(rf"^(?:\^?[A-Z]{{1,5}}(?:[.-][A-Z]{{1,2}})?|[A-Z]{{1,4}}=F|[A-Z0-9]{{1,10}}\.(?:{_SUFFIX_RE}))$")

# ── Inventory ──────────────────────────────────────────────────────────────
# (path relative to repo root, variable names). Python: AST assignments
# (module level or nested). TS/TSX: `const NAME ... = <literal>`.
CODE_SOURCES: Tuple[Tuple[str, Tuple[str, ...], str], ...] = (
    ("backend/app/api/market.py", ("SP500_STOCKS",), "US heatmap / movers / sectors / breadth / ticker tape universe"),
    ("backend/app/services/model_index/config.py", ("CURATED_UNIVERSE", "STOCK_ROLES"), "AI baskets (model index) universe"),
    ("backend/app/api/ideas.py", ("SCAN_UNIVERSE", "SECTOR_ETFS"), "Trade ideas scan universe"),
    ("backend/app/api/backtest.py", ("_US_STOCKS",), "Backtest symbol autocomplete"),
    ("backend/app/api/forecast.py", ("SECTOR_ETF", "WARM_TICKERS"), "Forecast exog map + cache warm list"),
    ("backend/app/api/enhanced_endpoints.py", ("_DEFAULT_ALERT_SYMBOLS",), "Default prediction-alert strip"),
    ("backend/app/api/outlook.py", ("_ETF_LIKE",), "Outlook ETF classification"),
    ("backend/app/services/copilot/sec_refresh.py", ("UNIVERSE",), "Copilot SEC refresh universe"),
    ("backend/app/services/exchange_universe_service.py", ("INDEX_MEMBERS",), "Exchange universe index flags"),
    ("backend/app/services/ticker_correlation.py", ("COUNTRY_COMPANY_EXPOSURE", "THEMATIC_ETFS", "SECTOR_LEADERS"), "Monitor event -> ticker correlation"),
    ("backend/app/api/monitor_extended.py", ("_TICKER_KEYWORDS", "_COMMODITY_SYMBOLS"), "Monitor ticker keywords / commodities"),
    ("backend/app/services/news_intel/tickers.py", ("_BRAND_ALIASES",), "News ticker tagging aliases"),
    ("backend/app/services/warmup.py", ("DEFAULT_STARTUP_TICKERS",), "Startup cache warm"),
    ("backend/app/services/idea_scheduler.py", ("index_symbols", "sector_etfs"), "Market pulse (indices + sector ETFs)"),
    ("frontend/src/lib/outlook.ts", ("DEFAULT_CALENDAR",), "Outlook quick picks / default calendar"),
    ("frontend/src/components/community/TrendingSidebar.tsx", ("FALLBACK_TICKERS",), "Community trending fallback"),
    ("frontend/src/components/backtest/MarketScanner.tsx", ("PRESETS",), "Backtest scanner presets"),
    ("frontend/src/lib/world-exchanges.ts", ("EXCHANGE_HEATMAP_STOCKS", "CONTINENT_NEWS_TICKERS", "ALWAYS_ON_MACRO_SYMBOLS", "CONTINENT_DASHBOARD_INDEX_SYMBOLS"), "Markets page exchange heatmaps / macro"),
    ("frontend/src/lib/global-monitor-api.ts", ("SECTOR_TICKERS", "CATEGORY_TICKERS"), "Monitor sector/category tickers"),
    ("frontend/src/components/monitor/GlobalStockTicker.tsx", ("SECTOR_TICKERS", "CRITICAL_TICKERS"), "Monitor stock ticker strip"),
    ("frontend/src/components/ui/fullscreen-calendar.tsx", ("EVENT_STOCK_MAP",), "Economic calendar affected tickers"),
)

# Variables whose dict keys are not tickers (country codes, sectors).
VALUES_ONLY = {"COUNTRY_COMPANY_EXPOSURE", "THEMATIC_ETFS", "SECTOR_LEADERS", "_TICKER_KEYWORDS",
               "EXCHANGE_HEATMAP_STOCKS", "CONTINENT_NEWS_TICKERS", "CONTINENT_DASHBOARD_INDEX_SYMBOLS",
               "SECTOR_TICKERS", "CATEGORY_TICKERS", "CRITICAL_TICKERS", "EVENT_STOCK_MAP", "PRESETS",
               "SCAN_UNIVERSE", "CURATED_UNIVERSE", "SP500_STOCKS"}
# Display aliases our UI maps to a real symbol (VIX -> ^VIX, DXY -> DX-Y.NYB).
ALIASES = {"VIX": "^VIX", "DXY": "DX-Y.NYB"}

# Prod public endpoints that list tickers (DB-backed lists).
PROD_LIST_ENDPOINTS = (
    ("/api/v1/market/universe?exchange=us&limit=500", "stocks", "Market universe (exchange_ranked_symbols, US)"),
    ("/api/v1/market/stocks?limit=500", None, "Market stocks (heatmap snapshot)"),
    ("/api/v1/market/movers?limit=50", ("gainers", "losers"), "Market movers"),
)

_WORDS = {  # literal strings in the sources that are not tickers
    "US", "UK", "EU", "USD", "ETF", "ETFS", "N/A", "A", "I", "AI", "IT", "OR", "AND", "THE", "NYSE", "NASDAQ",
    "AMEX", "OTC", "LSE", "TSX", "NSE", "BSE", "HKEX", "SSE", "JPX", "ASX", "FX", "GDP", "CPI", "PPI", "FOMC",
    "OPEC", "NATO", "EUR", "GBP", "JPY", "CNY", "INR", "CAD", "AUD", "CHF", "BRL", "KRW", "HKD", "HIGH", "LOW",
}


def _py_strings(node: ast.AST, values_only: bool = False) -> List[str]:
    """Ticker candidates in a literal. In (ticker, name, ...) tuples only the
    first element counts; ``values_only`` skips dict keys (country codes)."""
    out: List[str] = []

    def walk(n):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            out.append(n.value)
        elif isinstance(n, ast.Tuple) and n.elts and all(isinstance(e, ast.Constant) for e in n.elts) \
                and isinstance(n.elts[0].value, str):
            out.append(n.elts[0].value)
        elif isinstance(n, ast.Dict):
            for k, v in zip(n.keys, n.values):
                if k is not None and not values_only:
                    walk(k)
                walk(v)
        else:
            for c in ast.iter_child_nodes(n):
                walk(c)

    walk(node)
    return out


def _extract_py(src: str, names: Sequence[str]) -> List[str]:
    tree = ast.parse(src)
    out: List[str] = []
    for n in ast.walk(tree):
        targets = []
        if isinstance(n, ast.Assign):
            targets = n.targets
        elif isinstance(n, ast.AnnAssign) and n.value is not None:
            targets = [n.target]
        for t in targets:
            if isinstance(t, ast.Name) and t.id in names:
                out.extend(_py_strings(n.value, values_only=t.id in VALUES_ONLY))
    return out


def _balanced(src: str, start: int) -> str:
    """Text of the bracketed literal starting at the first [ or { after `start`."""
    i = min([j for j in (src.find("[", start), src.find("{", start)) if j >= 0], default=-1)
    if i < 0:
        return ""
    depth, quote = 0, None
    for j in range(i, len(src)):
        c = src[j]
        if quote:
            if c == "\\":
                continue
            if c == quote:
                quote = None
            continue
        if c in "'\"`":
            quote = c
        elif c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
    return src[i:]


def _extract_ts(src: str, names: Sequence[str]) -> List[str]:
    out: List[str] = []
    for name in names:
        for m in re.finditer(rf"\bconst\s+{re.escape(name)}\b[^=]*=", src):
            body = _balanced(src, m.end())
            # Arrays of objects carry the ticker in `symbol:` / `ticker:`; other
            # strings there are names. Plain arrays: every quoted string.
            keyed = re.findall(r"(?:symbol|ticker)\s*:\s*['\"]([^'\"]+)['\"]", body)
            if keyed:
                out.extend(keyed)
            else:
                if name in VALUES_ONLY:
                    body = re.sub(r"""['"][^'"\n]{1,40}['"]\s*:""", ":", body)
                out.extend(re.findall(r"""['"]([^'"\n]{1,16})['"]""", body))
    return out


def looks_like_ticker(s: str) -> bool:
    s = s.strip()
    return bool(TICKER_RE.match(s)) and s.upper() == s and s not in _WORDS


def collect_code_universe(repo_root: Path) -> Dict[str, Set[str]]:
    """{TICKER: {source description, ...}} for every curated list in CODE_SOURCES."""
    out: Dict[str, Set[str]] = {}
    for rel, names, desc in CODE_SOURCES:
        p = repo_root / rel
        if not p.exists():
            logger.warning("inventory source missing: %s", rel)
            continue
        src = p.read_text(errors="ignore")
        raw = _extract_py(src, names) if rel.endswith(".py") else _extract_ts(src, names)
        for s in raw:
            s = ALIASES.get(s, s)
            if looks_like_ticker(s) or s in ALIASES.values():
                out.setdefault(s.upper(), set()).add(f"{rel}:{'/'.join(names)}")
    return out


def code_names(repo_root: Path) -> Dict[str, str]:
    """{TICKER: display name} from (ticker, name) pairs in the Python lists."""
    out: Dict[str, str] = {}
    for rel, names, _ in CODE_SOURCES:
        if not rel.endswith(".py"):
            continue
        p = repo_root / rel
        if not p.exists():
            continue
        tree = ast.parse(p.read_text(errors="ignore"))
        for n in ast.walk(tree):
            if isinstance(n, ast.Tuple) and len(n.elts) >= 2 and all(isinstance(e, ast.Constant) for e in n.elts[:2]):
                a, b = n.elts[0].value, n.elts[1].value
                if isinstance(a, str) and isinstance(b, str) and looks_like_ticker(a) and not looks_like_ticker(b):
                    out.setdefault(a.upper(), b)
            if isinstance(n, ast.Dict):
                for k, v in zip(n.keys, n.values):
                    if (isinstance(k, ast.Constant) and isinstance(v, ast.Constant) and isinstance(k.value, str)
                            and isinstance(v.value, str) and looks_like_ticker(k.value) and len(v.value) > 5
                            and " " in v.value):
                        out.setdefault(k.value.upper(), v.value)
    return out


# ── Evidence + classification ─────────────────────────────────────────────

@dataclass
class Evidence:
    ticker: str
    sources: List[str] = field(default_factory=list)
    listed_name: Optional[str] = None        # what we display
    sec_name: Optional[str] = None           # SEC holder today (None: not in SEC map)
    asset_type: str = "equity"               # equity | etf | index | foreign | future
    last_bar: Optional[date] = None          # newest valid daily bar (any source)
    bar_source: Optional[str] = None
    bars_1y: int = 0                          # valid daily bars in the last year
    quote_price: Optional[float] = None
    quote_source: Optional[str] = None
    errors: List[str] = field(default_factory=list)


@dataclass
class Verdict:
    ticker: str
    status: str
    reason: str
    action: str
    successor: Optional[str] = None
    name_mismatch: bool = False
    sessions_since_bar: Optional[int] = None


def sessions_between(a: date, b: date) -> int:
    """Weekdays strictly after ``a`` up to and including ``b`` (holidays ignored)."""
    if a >= b:
        return 0
    n, d = 0, a
    while d < b:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def classify(ev: Evidence, today: Optional[date] = None, retirement=None,
             names_match: Optional[Callable[[Optional[str], Optional[str]], bool]] = None) -> Verdict:
    """Pure classifier. ``retirement`` is a ticker_lifecycle.Retirement or None."""
    from app.services.ticker_lifecycle import ACQUIRED, DELISTED, RENAMED as L_RENAMED, REUSED as L_REUSED

    if names_match is None:
        from app.services.instrument_identity import names_match as _nm

        names_match = _nm
    today = today or datetime.now(timezone.utc).date()
    since = sessions_between(ev.last_bar, today) if ev.last_bar else None
    trades = since is not None and since <= STALE_SESSIONS
    equity = ev.asset_type == "equity"
    mismatch = bool(equity and ev.sec_name and ev.listed_name and not names_match(ev.listed_name, ev.sec_name))

    def v(status, reason, action, succ=None):
        return Verdict(ev.ticker, status, reason, action, succ, mismatch, since)

    if retirement is not None:
        r = retirement
        if r.kind == L_RENAMED:
            return v(RENAMED, r.note, f"replace with {r.successor} in curated lists; mark inactive", r.successor)
        if r.kind in (ACQUIRED, DELISTED):
            act = "drop from curated lists; mark inactive" + (f" (successor {r.successor})" if r.successor else "")
            return v(GONE, r.note, act, r.successor)
        if r.kind == L_REUSED:
            return v(REUSED, f"{r.note} Now: {ev.sec_name or r.current_name or 'another issuer'}.",
                     "drop from curated lists; identity banner + data quality 'limited'", r.successor)
    if trades and mismatch:
        return v(OK, f"trading; name mismatch: we show {ev.listed_name!r}, SEC holder is {ev.sec_name!r}",
                 "use SEC's name (symbol_identity_refresh renames the symbols row); "
                 "add to RETIREMENTS as reused if it is a different company")
    if trades:
        return v(OK, f"last daily bar {ev.last_bar} ({ev.bar_source})", "none")
    if ev.last_bar is None and ev.quote_price is None:
        if equity and ev.sec_name is None:
            return v(GONE, "no daily bars, no quote, not in SEC ticker map", "add to RETIREMENTS after checking the successor")
        return v(UNKNOWN, "no daily bars and no quote from any provider" + (f" ({'; '.join(ev.errors)})" if ev.errors else ""),
                 "investigate provider coverage")
    if ev.last_bar is None:
        return v(UNKNOWN, f"quote only (${ev.quote_price} via {ev.quote_source}); no daily bars", "check bar providers")
    if equity and ev.sec_name is None and since and since > 30:
        return v(GONE, f"no daily bar since {ev.last_bar} ({since} sessions); not in SEC ticker map",
                 "add to RETIREMENTS after checking the successor")
    return v(STALE, f"no valid daily bar in the last {STALE_SESSIONS} sessions (last {ev.last_bar}, {since} sessions ago)",
             "check providers / halt")


# ── Completeness ───────────────────────────────────────────────────────────

COMPLETENESS_FIELDS = ("name", "exchange", "sector", "price", "prev_close", "volume", "market_cap", "pe",
                       "range_52w_250", "sma20", "sma50", "sma200", "rsi", "macd", "fundamentals",
                       "sec_filings", "news")
FUND_NA = {"pe", "sec_filings", "market_cap"}  # do not apply to ETFs/funds/indices


def completeness(t: str, quote: Optional[dict], fund: Optional[dict], ind: Optional[dict], bars: Optional[list],
                 sec: Optional[dict], news: Optional[list], asset_type: str = "equity") -> Tuple[float, List[str], List[str]]:
    """(score 0-100, missing fields, not-applicable fields) for one ticker's Research data."""
    fund = fund or {}
    notes = fund.get("field_notes") or {}
    i = (ind or {}).get("indicators") or {}
    q = quote or {}
    valid_bars = [b for b in (bars or []) if isinstance(b, dict) and b.get("close")]
    have = {
        "name": bool(fund.get("company_name")),
        "exchange": bool((sec or {}).get("exchange") or fund.get("exchange") or (q.get("exchange"))),
        "sector": bool(fund.get("sector")),
        "price": bool(q.get("last_price")),
        "prev_close": bool(q.get("previous_close")),
        "volume": q.get("volume") is not None,
        "market_cap": fund.get("market_cap") is not None,
        "pe": fund.get("pe_ratio") is not None or (notes.get("pe_ratio") or {}).get("status") in ("n/m", "n/a"),
        "range_52w_250": fund.get("week_52_high") is not None and len(valid_bars) >= 250,
        "sma20": i.get("sma_20") is not None,
        "sma50": i.get("sma_50") is not None,
        "sma200": i.get("sma_200") is not None,
        "rsi": i.get("rsi") is not None,
        "macd": (i.get("macd") or {}).get("macd") is not None,
        "fundamentals": bool(fund),
        "sec_filings": bool(sec) and (sec or {}).get("edgar_status") not in ("not_applicable", None) if sec else False,
        "news": bool(news),
    }
    fund_like = asset_type in ("etf", "fund", "index")
    na = sorted(FUND_NA) if fund_like else []
    if not fund_like and (notes.get("pe_ratio") or {}).get("status") == "n/m":
        na.append("pe")
    fields = [f for f in COMPLETENESS_FIELDS if f not in na]
    missing = [f for f in fields if not have[f]]
    score = round(100.0 * (len(fields) - len(missing)) / len(fields), 1)
    return score, missing, na


# ── Providers ──────────────────────────────────────────────────────────────

def _http_json(url: str, timeout: float = 30.0, headers: Optional[dict] = None):
    import requests

    for attempt in range(4):  # prod rate-limits bursts (429): back off and retry
        r = requests.get(url, timeout=timeout, headers=headers or {"User-Agent": "quanttrade-ticker-audit"})
        if r.status_code != 429:
            break
        time.sleep(2 + 3 * attempt)
    if r.status_code >= 400:
        return None, r.status_code
    try:
        return r.json(), r.status_code
    except ValueError:
        return None, r.status_code


def load_sec_map(path: Optional[str] = None) -> Dict[str, str]:
    """{TICKER: SEC title}. Uses symbol_identity_refresh's loader (SEC contact UA)."""
    from app.services.symbol_identity_refresh import fetch_sec_ticker_map

    return {t: v["title"] for t, v in fetch_sec_ticker_map(path).items()}


def asset_kind(t: str) -> str:
    if t.startswith("^"):
        return "index"
    if t.endswith("=F"):
        return "future"
    if "." in t and t.split(".")[-1] in FOREIGN_SUFFIXES and t.split(".")[-1] not in ("A", "B"):
        return "foreign"
    try:
        from app.services.ticker_validation import classify_asset_type

        k = classify_asset_type(t, None)
        return "etf" if k in ("etf", "fund") else "equity"
    except Exception:
        return "equity"


def yf_last_bars(tickers: Sequence[str]) -> Dict[str, Tuple[Optional[date], int]]:
    """{ticker: (last valid daily bar, bars in last year)} via yfinance (batched)."""
    import pandas as pd
    import yfinance as yf

    out: Dict[str, Tuple[Optional[date], int]] = {}
    syms = list(tickers)
    for i in range(0, len(syms), 80):
        chunk = syms[i:i + 80]
        ymap = {s: s if asset_kind(s) == "foreign" else s.replace(".", "-") for s in chunk}
        try:
            df = yf.download(list(ymap.values()), period="1y", interval="1d", group_by="ticker",
                             auto_adjust=False, progress=False, threads=True)
        except Exception as e:
            logger.warning("yfinance batch failed: %s", e)
            continue
        for s, y in ymap.items():
            try:
                sub = df[y] if isinstance(df.columns, pd.MultiIndex) else df
                c = pd.to_numeric(sub["Close"], errors="coerce").dropna()
                c = c[c > 0]
                out[s] = (c.index[-1].date() if len(c) else None, int(len(c)))
            except Exception:
                out[s] = (None, 0)
    # Batches drop symbols under rate limiting: retry the misses one by one.
    for s in [t for t in syms if not out.get(t, (None, 0))[0]]:
        try:
            y = s if asset_kind(s) == "foreign" else s.replace(".", "-")
            h = yf.Ticker(y).history(period="1y", auto_adjust=False)
            c = pd.to_numeric(h["Close"], errors="coerce").dropna() if not h.empty else h
            c = c[c > 0] if len(c) else c
            out[s] = (c.index[-1].date() if len(c) else None, int(len(c)))
        except Exception:
            out.setdefault(s, (None, 0))
    return out


def sip_last_bars(tickers: Sequence[str]) -> Dict[str, Tuple[Optional[date], int]]:
    try:
        from app.config import settings
        from app.services.alpaca_client import alpaca_client
    except Exception:
        return {}
    if not getattr(settings, "ALPACA_API_KEY", None):
        return {}
    out: Dict[str, Tuple[Optional[date], int]] = {}
    plain = [t for t in tickers if re.match(r"^[A-Z]{1,5}(\.[A-Z])?$", t)]
    for i in range(0, len(plain), 100):
        try:
            bars = alpaca_client.get_daily_bars_sip(plain[i:i + 100], days=370)
        except Exception as e:
            logger.warning("SIP batch failed: %s", e)
            continue
        for s, rows in bars.items():
            rows = [r for r in rows if r[4] and r[4] > 0]
            out[s] = (rows[-1][0] if rows else None, len(rows))
    return out


def prod_quote(base: str, t: str) -> Tuple[Optional[float], Optional[dict], int]:
    data, code = _http_json(f"{base}/api/v1/enhanced/quote/{t}")
    if isinstance(data, dict) and data.get("last_price"):
        return float(data["last_price"]), data, code
    return None, data if isinstance(data, dict) else None, code


def db_quote(t: str) -> Optional[float]:
    try:
        from app.db.database import SessionLocal
        from app.services.quote_cache import QuoteCacheService

        if SessionLocal is None:
            return None
        db = SessionLocal()
        try:
            q = QuoteCacheService(db).get_cached_quote(t)
            return float(q["price"]) if q and q.get("price") else None
        finally:
            db.close()
    except Exception:
        return None


def prod_lists(base: str) -> Dict[str, Set[str]]:
    out: Dict[str, Set[str]] = {}
    for path, key, desc in PROD_LIST_ENDPOINTS:
        data, code = _http_json(base + path, timeout=60)
        rows: list = []
        if isinstance(data, list):
            rows = data
        elif isinstance(data, dict):
            keys = key if isinstance(key, tuple) else (key,)
            for k in keys:
                rows += data.get(k) or []
        for r in rows:
            s = (r.get("symbol") or "").upper() if isinstance(r, dict) else ""
            if s:
                out.setdefault(s, set()).add(f"prod {path.split('?')[0]}")
    return out


def db_symbols() -> Dict[str, Tuple[str, Optional[str]]]:
    """{SYMBOL: (name, asset_type)} from the symbols table (prod container)."""
    from app.db.database import SessionLocal
    from app.models.symbol import Symbol

    db = SessionLocal()
    try:
        return {s.upper(): (n, a) for s, n, a in db.query(Symbol.symbol, Symbol.name, Symbol.asset_type).all()}
    finally:
        db.close()


# ── Runner ─────────────────────────────────────────────────────────────────

def run_audit(tickers: Dict[str, Set[str]], names: Dict[str, str], sec_map: Dict[str, str],
              prod_api: Optional[str] = None, use_db: bool = False, workers: int = 3, use_sip: bool = True) -> List[Tuple[Evidence, Verdict]]:
    from app.services.instrument_identity import names_match
    from app.services.ticker_lifecycle import retirement

    syms = sorted(tickers)
    yf_bars = yf_last_bars(syms)
    sip = sip_last_bars(syms) if use_sip else {}
    evs: Dict[str, Evidence] = {}
    for t in syms:
        ev = Evidence(t, sorted(tickers[t]), names.get(t), sec_map.get(t.replace(".", "-")), asset_kind(t))
        cands = [(d, n, src) for (d, n), src in ((yf_bars.get(t, (None, 0)), "yfinance"), (sip.get(t, (None, 0)), "alpaca_sip")) if d]
        if cands:
            d, n, src = max(cands)
            ev.last_bar, ev.bars_1y, ev.bar_source = d, n, src
        evs[t] = ev

    def quote(t):
        ev = evs[t]
        if use_db:
            p = db_quote(t)
            if p:
                ev.quote_price, ev.quote_source = p, "QuoteCacheService"
                return
        if prod_api:
            p, body, code = prod_quote(prod_api, t)
            if p:
                ev.quote_price, ev.quote_source = p, "prod /enhanced/quote"
            elif code == 410:
                ev.errors.append("prod quote 410 inactive")
            elif code >= 400:
                ev.errors.append(f"prod quote HTTP {code}")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(quote, syms))
    return [(evs[t], classify(evs[t], retirement=retirement(t), names_match=names_match)) for t in syms]


def run_completeness(base: str, tickers: Sequence[str], workers: int = 3) -> Dict[str, Tuple[float, List[str], List[str]]]:
    def one(t):
        try:
            q, _ = _http_json(f"{base}/api/v1/enhanced/quote/{t}")
            f, _ = _http_json(f"{base}/api/v1/enhanced/fundamentals/{t}", timeout=60)
            i, _ = _http_json(f"{base}/api/v1/indicators/{t}", timeout=60)
            end = datetime.now(timezone.utc)
            start = end - timedelta(days=380)
            b, _ = _http_json(f"{base}/api/v1/prices/{t}?start={start:%Y-%m-%dT00:00:00}&end={end:%Y-%m-%dT00:00:00}&limit=400", timeout=60)
            s, _ = _http_json(f"{base}/api/v1/research/{t}/company-overview", timeout=60)
            n, _ = _http_json(f"{base}/api/v1/news/feed?ticker={t}&limit=5", timeout=60)
            news = n.get("items") if isinstance(n, dict) else n
            kind = (f or {}).get("asset_type") or asset_kind(t)
            return t, completeness(t, q, f, i, b, s, news, kind)
        except Exception as e:
            return t, (0.0, [f"error: {e}"], [])

    out = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for t, res in pool.map(one, tickers):
            out[t] = res
    return out


SWEEP_SAMPLE = (
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "ORCL", "AMD",        # tech / mega caps
    "JPM", "BAC", "GS", "V", "BRK.B",                                                       # financials
    "UNH", "LLY", "JNJ", "PFE", "MRNA",                                                     # healthcare
    "XOM", "CVX", "COP", "SLB",                                                             # energy
    "WMT", "COST", "KO", "MCD", "NKE",                                                      # consumer
    "CAT", "BA", "GE", "UNP",                                                               # industrials
    "NEE", "PLD", "T",                                                                      # utilities / RE / telecom
    "SPY", "QQQ", "IWM", "GLD", "TLT", "XLE",                                               # ETFs
    "XYZ", "MRSH", "SKYD",                                                                  # successors of retired tickers
)

SWEEP_ENDPOINTS = (
    ("quote", "/api/v1/enhanced/quote/{t}", ("last_price", "previous_close", "volume")),
    ("prices", "/api/v1/prices/{t}?limit=300", None),
    ("indicators", "/api/v1/indicators/{t}", ("indicators.sma_20", "indicators.sma_50", "indicators.sma_200",
                                               "indicators.rsi", "indicators.macd.macd")),
    ("fundamentals", "/api/v1/enhanced/fundamentals/{t}", ("company_name", "market_cap", "week_52_high")),
    ("identity", "/api/v1/research/{t}/identity", ("status",)),
    ("company_overview", "/api/v1/research/{t}/company-overview", ("company_name",)),
    ("options_expirations", "/api/v1/options/{t}/expirations", ("expirations",)),
    ("forecast", "/api/v1/forecast/{t}", None),
    ("news_feed", "/api/v1/news/feed?ticker={t}&limit=5", ("items",)),
)


def _dig(d, path: str):
    for part in path.split("."):
        if not isinstance(d, dict):
            return None
        d = d.get(part)
    return d


def endpoint_sweep(base: str, tickers: Sequence[str] = SWEEP_SAMPLE, workers: int = 3) -> List[dict]:
    """Hit every main Research API for each ticker; report errors and null fields."""
    def one(t):
        rows = []
        for name, path, fields in SWEEP_ENDPOINTS:
            url = base + path.format(t=t)
            t0 = time.time()
            try:
                data, code = _http_json(url, timeout=120)
            except Exception as e:
                rows.append({"ticker": t, "endpoint": name, "status": "error", "detail": str(e)[:120]})
                continue
            ms = int((time.time() - t0) * 1000)
            if code >= 400 or data is None:
                rows.append({"ticker": t, "endpoint": name, "status": f"HTTP {code}", "ms": ms})
                continue
            nulls = []
            if name == "prices":
                bad = [b for b in data if isinstance(b, dict) and b.get("close") is None]
                if not data:
                    nulls.append("no bars")
                if bad:
                    nulls.append(f"{len(bad)} null-close bars")
            fund_like = isinstance(data, dict) and data.get("asset_type") in ("etf", "fund", "index")
            for f in fields or ():
                if fund_like and f in ("market_cap",):
                    continue  # funds have AUM, not a market cap
                v = _dig(data, f)
                if v is None or v == [] or v == "":
                    nulls.append(f)
            rows.append({"ticker": t, "endpoint": name, "status": "nulls" if nulls else "ok",
                         "detail": ", ".join(nulls), "ms": ms})
        return rows

    out: List[dict] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for rows in pool.map(one, tickers):
            out.extend(rows)
    return out


def to_markdown(results: List[Tuple[Evidence, Verdict]], comp: Optional[Dict[str, tuple]] = None,
                generated: Optional[str] = None, sweep: Optional[List[dict]] = None) -> str:
    counts = {c: 0 for c in CLASSES}
    for _, v in results:
        counts[v.status] += 1
    lines = [f"Generated {generated or datetime.now(timezone.utc).isoformat(timespec='minutes')} by "
             "`backend/scripts/audit_ticker_universe.py`.", "",
             "| class | count |", "|---|---|"]
    lines += [f"| {c} | {counts[c]} |" for c in CLASSES]
    mism = [v for _, v in results if v.name_mismatch]
    lines += ["", f"Total tickers: {len(results)}. Name mismatches vs SEC: {len(mism)}.", "",
              "## Non-ok tickers", "",
              "| ticker | class | successor | reason | action | listed in |", "|---|---|---|---|---|---|"]
    for ev, v in results:
        if v.status == OK and not v.name_mismatch:
            continue
        src = "<br>".join(sorted({s.split(':')[0] for s in ev.sources}))
        lines.append(f"| {v.ticker} | {v.status}{' (name mismatch)' if v.name_mismatch and v.status == OK else ''} | "
                     f"{v.successor or ''} | {v.reason} | {v.action} | {src} |")
    if comp:
        lines += ["", "## Completeness (prod Research data)", "",
                  "Fields: " + ", ".join(COMPLETENESS_FIELDS) + ". ETFs/funds/indices skip P/E, market cap and SEC "
                  "filings; P/E of a loss-maker counts when shown as n/m.", ""]
        full = sum(1 for s, _, _ in comp.values() if s >= 100)
        lines += [f"{full}/{len(comp)} sampled tickers at 100%.", "",
                  "| ticker | score | missing |", "|---|---|---|"]
        for t, (s, missing, _) in sorted(comp.items(), key=lambda kv: (kv[1][0], kv[0])):
            if s < 100:
                lines.append(f"| {t} | {s} | {', '.join(missing)} |")
    if sweep:
        bad = [r for r in sweep if r["status"] != "ok"]
        lines += ["", "## Endpoint sweep (prod)", "",
                  f"{len(sweep) - len(bad)}/{len(sweep)} endpoint calls ok across {len({r['ticker'] for r in sweep})} tickers.",
                  "", "| ticker | endpoint | status | detail |", "|---|---|---|---|"]
        lines += [f"| {r['ticker']} | {r['endpoint']} | {r['status']} | {r.get('detail', '')} |" for r in bad]
    lines += ["", "## All tickers", "", "| ticker | class | last bar | source | quote | listed in |", "|---|---|---|---|---|---|"]
    for ev, v in results:
        src = ", ".join(sorted({s.split(':')[0].split('/')[-1] for s in ev.sources}))
        lines.append(f"| {ev.ticker} | {v.status} | {ev.last_bar or ''} | {ev.bar_source or ''} | "
                     f"{ev.quote_price if ev.quote_price is not None else ''} | {src} |")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.services.ticker_audit", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[3]))
    ap.add_argument("--prod-api", help="public API base, e.g. https://www.quanttrade.us")
    ap.add_argument("--db", action="store_true", help="also audit every symbols row and use QuoteCacheService")
    ap.add_argument("--tickers", help="comma-separated subset")
    ap.add_argument("--sec-json", help="local copy of SEC company_tickers.json")
    ap.add_argument("--completeness", help="comma-separated tickers to score against --prod-api ('all' = every ok ticker)")
    ap.add_argument("--sweep", action="store_true", help="hit every main API for SWEEP_SAMPLE on --prod-api")
    ap.add_argument("--json", help="write raw results as JSON")
    ap.add_argument("--markdown", help="write the markdown report")
    ap.add_argument("--no-sip", action="store_true", help="skip Alpaca SIP bars (no keys locally)")
    ap.add_argument("--apply", action="store_true", help="write symbols lifecycle columns (never deletes)")
    ap.add_argument("--allow-production", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING)

    if args.db or args.apply:
        from app.config_aws import inject_aws_secrets

        inject_aws_secrets()

    root = Path(args.repo_root)
    tickers: Dict[str, Set[str]] = collect_code_universe(root)
    names = code_names(root)
    if args.prod_api:
        for t, srcs in prod_lists(args.prod_api.rstrip("/")).items():
            tickers.setdefault(t, set()).update(srcs)
    if args.db:
        for t, (n, a) in db_symbols().items():
            tickers.setdefault(t, set()).add("symbols table")
            if n:
                names[t] = n  # what the Research page displays
    if args.tickers:
        want = {t.strip().upper() for t in args.tickers.split(",") if t.strip()}
        tickers = {t: tickers.get(t, {"--tickers"}) for t in want}
    sec_map = load_sec_map(args.sec_json)
    t0 = time.time()
    results = run_audit(tickers, names, sec_map, args.prod_api and args.prod_api.rstrip("/"), use_db=args.db,
                        use_sip=not args.no_sip)
    comp = None
    if args.completeness and args.prod_api:
        sel = ([ev.ticker for ev, v in results if v.status == OK] if args.completeness == "all"
               else [t.strip().upper() for t in args.completeness.split(",") if t.strip()])
        comp = run_completeness(args.prod_api.rstrip("/"), sel)
    sweep = endpoint_sweep(args.prod_api.rstrip("/")) if args.sweep and args.prod_api else None
    counts: Dict[str, int] = {}
    for _, v in results:
        counts[v.status] = counts.get(v.status, 0) + 1
    print(f"Audited {len(results)} tickers in {time.time() - t0:.0f}s: {counts}")
    for ev, v in results:
        if v.status != OK or v.name_mismatch:
            print(f"  {v.ticker:8s} {v.status:22s} {v.successor or '':6s} {v.reason}")
    if args.json:
        Path(args.json).write_text(json.dumps({"results": [{**asdict(ev), **asdict(v)} for ev, v in results],
                                               "completeness": comp, "sweep": sweep}, default=str, indent=1))
    if args.markdown:
        Path(args.markdown).write_text(to_markdown(results, comp, sweep=sweep))
    if args.apply:
        from app.db.database import SessionLocal
        from app.services.symbol_identity_refresh import is_remote_db_host
        from app.services.ticker_lifecycle import apply_retirements

        db = SessionLocal()
        try:
            host = db.get_bind().url.host or "local"
            if is_remote_db_host(host) and not args.allow_production:
                print(f"Refusing to write remote database {host!r} without --allow-production.", file=sys.stderr)
                return 2
            print(f"Applied retirements: {apply_retirements(db)}")
        finally:
            db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
