"""
News sources: HTTP pollers (Finnhub, Google News RSS, Yahoo Finance RSS,
PR Newswire / GlobeNewswire / Business Wire RSS, SEC EDGAR current 8-K Atom)
and the Alpaca (Benzinga) news WebSocket.

Every poller is `async def fetch(client) -> list[RawItem]`. Feed parsing
(feedparser, CPU) runs in a worker thread. All HTTP calls carry timeouts.
"""
from __future__ import annotations

import asyncio
import calendar
import html
import json
import logging
import os
import random
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

HTTP_TIMEOUT = httpx.Timeout(12.0, connect=5.0)
BOT_UA = "QuantTradeNewsBot/1.0 (+https://quanttrade.us)"


@dataclass
class RawItem:
    feed: str                  # poller key (finnhub_general, sec_8k, alpaca, ...)
    source: str                # publisher shown to users
    title: str
    url: str = ""
    summary: str = ""
    published_at: Optional[datetime] = None
    symbols: List[str] = field(default_factory=list)
    image_url: Optional[str] = None
    category_hints: List[str] = field(default_factory=list)
    received_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


_TAG = re.compile(r"<[^>]+>")


def clean_text(s: Optional[str], limit: int = 600) -> str:
    if not s:
        return ""
    s = html.unescape(_TAG.sub(" ", s))
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit]


def _ts(st) -> Optional[datetime]:
    if not st:
        return None
    try:
        return datetime.fromtimestamp(calendar.timegm(st), tz=timezone.utc)
    except Exception:
        return None


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ── RSS / Atom ──────────────────────────────────────────────────────────

def parse_feed(content: bytes, feed_key: str, default_source: str, *, use_entry_source: bool = False,
               keep_summary: bool = True, limit: int = 60) -> List[RawItem]:
    import feedparser

    parsed = feedparser.parse(content)
    out: List[RawItem] = []
    for e in parsed.entries[:limit]:
        title = clean_text(e.get("title"), 600)
        if not title:
            continue
        source = default_source
        if use_entry_source:
            src = e.get("source") or {}
            source = (src.get("title") if isinstance(src, dict) else None) or default_source
            # Google News appends " - Publisher" (publishers may contain dashes)
            suffix = f" - {source}"
            if source != default_source and title.endswith(suffix):
                title = title[: -len(suffix)].strip() or title
        image = None
        for m in (e.get("media_content") or []) + (e.get("media_thumbnail") or []):
            if isinstance(m, dict) and m.get("url"):
                image = m["url"]
                break
        out.append(RawItem(
            feed=feed_key,
            source=source,
            title=title,
            url=(e.get("link") or "").strip(),
            summary=clean_text(e.get("summary"), 600) if keep_summary else "",
            published_at=_ts(e.get("published_parsed") or e.get("updated_parsed")),
            image_url=image,
        ))
    return out


async def _get(client: httpx.AsyncClient, url: str, headers: Optional[Dict[str, str]] = None,
               params: Optional[dict] = None) -> httpx.Response:
    r = await client.get(url, headers=headers or {"User-Agent": BOT_UA}, params=params,
                         timeout=HTTP_TIMEOUT, follow_redirects=True)
    r.raise_for_status()
    return r


def rss_poller(feed_key: str, url: str, source: str, **parse_kw) -> Callable[[httpx.AsyncClient], Awaitable[List[RawItem]]]:
    async def fetch(client: httpx.AsyncClient) -> List[RawItem]:
        r = await _get(client, url)
        return await asyncio.to_thread(parse_feed, r.content, feed_key, source, **parse_kw)
    fetch.__name__ = f"fetch_{feed_key}"
    return fetch


# ── Finnhub ─────────────────────────────────────────────────────────────

def parse_finnhub(data, feed_key: str) -> List[RawItem]:
    out: List[RawItem] = []
    for it in data if isinstance(data, list) else []:
        title = clean_text(it.get("headline"), 600)
        if not title:
            continue
        ts = it.get("datetime")
        related = [s.strip() for s in str(it.get("related") or "").split(",") if s.strip()]
        out.append(RawItem(
            feed=feed_key,
            source=(it.get("source") or "Finnhub").strip(),
            title=title,
            url=(it.get("url") or "").strip(),
            summary=clean_text(it.get("summary"), 600),
            published_at=datetime.fromtimestamp(int(ts), tz=timezone.utc) if ts else None,
            symbols=related[:8],
            image_url=it.get("image") or None,
            category_hints=["mna"] if feed_key == "finnhub_merger" else [],
        ))
    return out


def finnhub_poller(category: str) -> Callable[[httpx.AsyncClient], Awaitable[List[RawItem]]]:
    feed_key = f"finnhub_{category}"

    async def fetch(client: httpx.AsyncClient) -> List[RawItem]:
        from app.config import settings

        token = (settings.FINNHUB_API_KEY or "").strip()
        if not token:
            return []
        # Token in a header, not the query string, so it never appears in error messages/logs.
        r = await client.get("https://finnhub.io/api/v1/news", params={"category": category},
                             headers={"X-Finnhub-Token": token}, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        return parse_finnhub(r.json(), feed_key)
    fetch.__name__ = f"fetch_{feed_key}"
    return fetch


# ── SEC EDGAR current 8-K feed ──────────────────────────────────────────

SEC_8K_URL = ("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb="
              "&owner=include&start=0&count=40&output=atom")

# 8-K item -> (short description, category hint)
_8K_ITEMS = {
    "1.01": ("Material Definitive Agreement", "product_business"),
    "1.02": ("Termination of Material Agreement", "product_business"),
    "1.03": ("Bankruptcy or Receivership", "regulatory_legal"),
    "1.05": ("Material Cybersecurity Incident", "product_business"),
    "2.01": ("Completion of Acquisition or Disposition", "mna"),
    "2.02": ("Results of Operations", "earnings"),
    "2.03": ("New Financial Obligation", "ipo_offering"),
    "2.05": ("Exit or Disposal Activities", "product_business"),
    "2.06": ("Material Impairments", "earnings"),
    "3.01": ("Delisting Notice", "regulatory_legal"),
    "3.02": ("Unregistered Equity Sale", "ipo_offering"),
    "4.01": ("Change in Auditor", "regulatory_legal"),
    "4.02": ("Non-Reliance on Prior Financials", "regulatory_legal"),
    "5.01": ("Change in Control", "mna"),
    "5.02": ("Executive/Director Change", "product_business"),
    "5.07": ("Shareholder Vote Results", "other"),
    "7.01": ("Regulation FD Disclosure", "other"),
    "8.01": ("Other Events", "other"),
}
_SEC_TITLE = re.compile(r"^\s*8-K(?:/A)?\s*-\s*(.+?)\s*\((\d{4,10})\)\s*\((?:Filer|Subject)\)", re.I)
_ITEM = re.compile(r"Item\s+(\d\.\d\d)", re.I)


def parse_sec_8k(content: bytes) -> List[RawItem]:
    import feedparser

    parsed = feedparser.parse(content)
    out: List[RawItem] = []
    for e in parsed.entries:
        m = _SEC_TITLE.match(e.get("title") or "")
        if not m:
            continue
        company = m.group(1).strip()
        items = list(dict.fromkeys(_ITEM.findall(e.get("summary") or "")))
        known = [i for i in items if i in _8K_ITEMS]
        descs = [_8K_ITEMS[i][0] for i in known][:2]
        hints = [_8K_ITEMS[i][1] for i in known if _8K_ITEMS[i][1] != "other"]
        what = "; ".join(descs) if descs else "Current Report"
        title = f"{company.title()} files 8-K: {what}"
        out.append(RawItem(
            feed="sec_8k",
            source="SEC EDGAR",
            title=title[:600],
            url=(e.get("link") or "").strip(),
            summary=", ".join(f"Item {i}" for i in items)[:300],
            published_at=_ts(e.get("updated_parsed") or e.get("published_parsed")),
            category_hints=list(dict.fromkeys(hints)),
        ))
    return out


async def fetch_sec_8k(client: httpx.AsyncClient) -> List[RawItem]:
    # SEC fair-access policy requires a descriptive User-Agent with contact.
    # Reuse the app's constant; never log it (it contains a private email).
    from app.services.sec_edgar_service import USER_AGENT as SEC_UA

    r = await _get(client, SEC_8K_URL, headers={"User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate"})
    return await asyncio.to_thread(parse_sec_8k, r.content)


# ── Registry ────────────────────────────────────────────────────────────

YAHOO_SYMBOLS = "^GSPC,^DJI,^IXIC,SPY,QQQ,AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,JPM"


@dataclass
class PollerSpec:
    key: str
    label: str
    fetch: Callable[[httpx.AsyncClient], Awaitable[List[RawItem]]]
    interval: float = 60.0
    requires: Optional[str] = None  # settings attribute that must be set


def default_pollers() -> List[PollerSpec]:
    interval = float(os.environ.get("NEWS_INTEL_POLL_SECONDS", "60"))
    # Google News rate-limits one IP polling two feeds every 60s (429s in prod).
    # It is an aggregator whose items already lag the original publisher by
    # minutes to hours, so a slower poll loses nothing; the wires stay at 60s.
    google_interval = max(interval, float(os.environ.get("NEWS_GOOGLE_POLL_SECONDS", "180")))
    return [
        PollerSpec("finnhub_general", "Finnhub general", finnhub_poller("general"), interval, "FINNHUB_API_KEY"),
        PollerSpec("finnhub_merger", "Finnhub merger", finnhub_poller("merger"), interval, "FINNHUB_API_KEY"),
        PollerSpec("google_business", "Google News business",
                   rss_poller("google_business",
                              "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en",
                              "Google News", use_entry_source=True, keep_summary=False), google_interval),
        PollerSpec("google_markets", "Google News markets",
                   rss_poller("google_markets",
                              "https://news.google.com/rss/search?q=%22stock+market%22+OR+stocks+OR+%22Wall+Street%22+when:1d&hl=en-US&gl=US&ceid=US:en",
                              "Google News", use_entry_source=True, keep_summary=False), google_interval),
        PollerSpec("yahoo_finance", "Yahoo Finance RSS",
                   rss_poller("yahoo_finance",
                              f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={YAHOO_SYMBOLS}&region=US&lang=en-US",
                              "Yahoo Finance"), interval),
        PollerSpec("prnewswire", "PR Newswire",
                   rss_poller("prnewswire", "https://www.prnewswire.com/rss/news-releases-list.rss", "PR Newswire"),
                   interval),
        PollerSpec("globenewswire", "GlobeNewswire",
                   rss_poller("globenewswire",
                              "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies",
                              "GlobeNewswire"), interval),
        PollerSpec("businesswire", "Business Wire",
                   rss_poller("businesswire", "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeGVtRWA==",
                              "Business Wire"), interval),
        PollerSpec("sec_8k", "SEC EDGAR 8-K", fetch_sec_8k, interval),
    ]


# ── Alpaca / Benzinga news stream ───────────────────────────────────────

ALPACA_NEWS_WS = os.environ.get("ALPACA_NEWS_WS_URL", "wss://stream.data.alpaca.markets/v1beta1/news")


def parse_alpaca_message(msg: dict) -> Optional[RawItem]:
    if msg.get("T") != "n":
        return None
    title = clean_text(msg.get("headline"), 600)
    if not title:
        return None
    src = (msg.get("source") or "benzinga").strip()
    return RawItem(
        feed="alpaca",
        source="Benzinga" if src.lower() == "benzinga" else src.title(),
        title=title,
        url=(msg.get("url") or "").strip(),
        summary=clean_text(msg.get("summary"), 600),
        published_at=_parse_iso(msg.get("created_at")) or _parse_iso(msg.get("updated_at")),
        symbols=[s for s in (msg.get("symbols") or []) if isinstance(s, str)][:8],
    )


class AlpacaNewsStream:
    """Auth -> subscribe news:* -> push RawItems to `sink`. Reconnects with
    exponential backoff + jitter (1s .. 60s)."""

    def __init__(self, key: str, secret: str, sink: Callable[[RawItem], Awaitable[None]],
                 url: str = ALPACA_NEWS_WS, on_state: Optional[Callable[[bool, Optional[str]], None]] = None):
        self.key, self.secret, self.sink, self.url = key, secret, sink, url
        self.connected = False
        self.on_state = on_state
        self.last_error: Optional[str] = None
        self.messages = 0

    def _set(self, connected: bool, err: Optional[str] = None):
        self.connected = connected
        if err:
            self.last_error = err
        if self.on_state:
            try:
                self.on_state(connected, err)
            except Exception:
                pass

    async def run(self) -> None:
        import websockets

        backoff = 1.0
        while True:
            try:
                async with websockets.connect(self.url, open_timeout=10, ping_interval=20, ping_timeout=20,
                                              max_size=2 ** 22) as ws:
                    await ws.send(json.dumps({"action": "auth", "key": self.key, "secret": self.secret}))
                    authed = False
                    while not authed:
                        raw = await asyncio.wait_for(ws.recv(), timeout=15)
                        for m in json.loads(raw):
                            if m.get("T") == "error":
                                raise RuntimeError(f"alpaca error {m.get('code')}: {m.get('msg')}")
                            if m.get("T") == "success" and m.get("msg") == "authenticated":
                                authed = True
                    await ws.send(json.dumps({"action": "subscribe", "news": ["*"]}))
                    self._set(True)
                    backoff = 1.0
                    async for raw in ws:
                        try:
                            msgs = json.loads(raw)
                        except ValueError:
                            continue
                        for m in msgs if isinstance(msgs, list) else [msgs]:
                            if m.get("T") == "error":
                                raise RuntimeError(f"alpaca error {m.get('code')}: {m.get('msg')}")
                            item = parse_alpaca_message(m)
                            if item:
                                self.messages += 1
                                await self.sink(item)
                self._set(False, "closed")
            except asyncio.CancelledError:
                self._set(False)
                raise
            except Exception as e:
                # Never include credentials: only the exception type/message.
                self._set(False, f"{type(e).__name__}: {str(e)[:200]}")
                logger.warning("Alpaca news stream disconnected: %s", self.last_error)
            await asyncio.sleep(backoff + random.uniform(0, backoff / 2))
            backoff = min(60.0, backoff * 2)
