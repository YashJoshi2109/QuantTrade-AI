"""
Dedupe and near-duplicate clustering.

1. Exact duplicate: same canonical URL (tracking params, fragment, www.,
   trailing slash stripped) -> dropped.
2. Same story, different outlet: same normalized-title hash -> joins cluster.
3. Near duplicate: token-set Jaccard >= JACCARD_MIN, or overlap coefficient
   >= OVERLAP_MIN when both titles have >= 5 tokens, against clusters seen in
   the last WINDOW_HOURS -> joins cluster.

In-memory and bounded (clusters older than the window are pruned). Candidate
lookup goes through an inverted token index so a new title is compared only
with clusters sharing at least two tokens.
"""
from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Set
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

WINDOW_HOURS = 24
JACCARD_MIN = 0.55
OVERLAP_MIN = 0.85

_TRACKING_PARAMS = re.compile(
    r"^(utm_\w+|guccounter|guce_\w+|ncid|cmpid|cmp|mod|ref|refsrc|src|source|siteid|yptr|"
    r"fbclid|gclid|mc_cid|mc_eid|ocid|tsrc|soc_src|soc_trk|taid|rss|feedtype|feedname|.?tracking\w*)$",
    re.I,
)

_STOP = frozenset(
    "a an the and or of to in on for at by with from as is are was were be been it its this that "
    "after before over amid into says said say report reports reported new up down vs via than "
    "will would could may might has have had more most just now today why how what who".split()
)

# Google News / Yahoo titles end in " - Publisher"; strip it before hashing.
_PUBLISHER_SUFFIX = re.compile(r"\s+[-|–—]\s+[^-|–—]{2,60}$")


def canonical_url(url: Optional[str]) -> str:
    if not url:
        return ""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip()
    host = (parts.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if parts.port and parts.port not in (80, 443):
        host = f"{host}:{parts.port}"
    query = urlencode(sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False)
                             if not _TRACKING_PARAMS.match(k)))
    path = parts.path.rstrip("/") or "/"
    return urlunsplit(("https", host, path, query, ""))


def strip_publisher(title: str) -> str:
    return _PUBLISHER_SUFFIX.sub("", (title or "").strip())


def normalize_title(title: str) -> str:
    t = strip_publisher(title).lower()
    t = re.sub(r"[’'`]s\b", "", t)
    t = re.sub(r"[^a-z0-9$%. ]+", " ", t)
    t = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", t)  # keep decimals like 3.5
    return re.sub(r"\s+", " ", t).strip()


def title_tokens(title: str) -> Set[str]:
    return {w for w in normalize_title(title).split() if len(w) > 1 and w not in _STOP}


def sha(s: str, n: int = 16) -> str:
    return hashlib.sha1(s.encode("utf-8", "ignore")).hexdigest()[:n]


def url_hash(url: Optional[str]) -> str:
    c = canonical_url(url)
    return sha(c) if c else ""


def title_hash(title: str) -> str:
    return sha(normalize_title(title))


def jaccard(a: Set[str], b: Set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def overlap(a: Set[str], b: Set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def is_near_duplicate(a: Set[str], b: Set[str]) -> bool:
    if jaccard(a, b) >= JACCARD_MIN:
        return True
    return min(len(a), len(b)) >= 5 and overlap(a, b) >= OVERLAP_MIN


@dataclass
class _Cluster:
    cluster_id: str
    tokens: Set[str]
    last_seen: datetime
    title_hashes: Set[str] = field(default_factory=set)


@dataclass
class Decision:
    kind: str           # "new" | "join" | "duplicate"
    cluster_id: str
    url_hash: str
    title_hash: str
    similarity: float = 1.0


class Clusterer:
    def __init__(self, window_hours: int = WINDOW_HOURS):
        self.window = timedelta(hours=window_hours)
        self._clusters: Dict[str, _Cluster] = {}
        self._by_url: Dict[str, str] = {}
        self._url_seen: Dict[str, datetime] = {}
        self._by_title: Dict[str, str] = {}
        self._index: Dict[str, Set[str]] = defaultdict(set)

    def __len__(self) -> int:
        return len(self._clusters)

    def _now(self, now: Optional[datetime]) -> datetime:
        return now or datetime.now(timezone.utc)

    def prune(self, now: Optional[datetime] = None) -> int:
        cutoff = self._now(now) - self.window
        dead = [cid for cid, c in self._clusters.items() if c.last_seen < cutoff]
        for cid in dead:
            c = self._clusters.pop(cid)
            for tok in c.tokens:
                s = self._index.get(tok)
                if s:
                    s.discard(cid)
                    if not s:
                        self._index.pop(tok, None)
            for th in c.title_hashes:
                if self._by_title.get(th) == cid:
                    self._by_title.pop(th, None)
        for uh in [u for u, ts in self._url_seen.items() if ts < cutoff]:
            self._url_seen.pop(uh, None)
            self._by_url.pop(uh, None)
        return len(dead)

    def _register(self, cid: str, tokens: Set[str], th: str, uh: str, now: datetime) -> None:
        c = self._clusters.get(cid)
        if c is None:
            c = _Cluster(cid, set(tokens), now)
            self._clusters[cid] = c
            for tok in tokens:
                self._index[tok].add(cid)
        c.last_seen = max(c.last_seen, now)
        if th:
            c.title_hashes.add(th)
            self._by_title.setdefault(th, cid)
        if uh:
            self._by_url[uh] = cid
            self._url_seen[uh] = now

    def seed(self, cluster_id: str, title: str, urls: Iterable[str] = (), seen_at: Optional[datetime] = None,
             titles: Iterable[str] = ()) -> None:
        """Rebuild state from persisted clusters (startup)."""
        now = self._now(seen_at)
        self._register(cluster_id, title_tokens(title), title_hash(title), "", now)
        for t in titles:
            th = title_hash(t)
            self._clusters[cluster_id].title_hashes.add(th)
            self._by_title.setdefault(th, cluster_id)
        for u in urls:
            uh = url_hash(u)
            if uh:
                self._by_url[uh] = cluster_id
                self._url_seen[uh] = now

    def assign(self, title: str, url: Optional[str], now: Optional[datetime] = None) -> Decision:
        now = self._now(now)
        uh, th = url_hash(url), title_hash(title)
        if uh and uh in self._by_url:
            cid = self._by_url[uh]
            return Decision("duplicate", cid, uh, th)
        if th and th in self._by_title and self._by_title[th] in self._clusters:
            cid = self._by_title[th]
            self._register(cid, set(), th, uh, now)
            return Decision("join", cid, uh, th)
        toks = title_tokens(title)
        best_cid, best_sim = None, 0.0
        if len(toks) >= 3:
            counts: Dict[str, int] = defaultdict(int)
            for tok in toks:
                for cid in self._index.get(tok, ()):
                    counts[cid] += 1
            for cid, shared in counts.items():
                if shared < 2:
                    continue
                other = self._clusters[cid].tokens
                if is_near_duplicate(toks, other):
                    sim = jaccard(toks, other)
                    if sim >= best_sim:
                        best_cid, best_sim = cid, sim
        if best_cid:
            self._register(best_cid, set(), th, uh, now)
            return Decision("join", best_cid, uh, th, round(best_sim, 3))
        # Unique across days: the same headline re-run next week is a new story.
        cid = sha(f"{th}|{uh}|{now.isoformat()}")
        self._register(cid, toks, th, uh, now)
        return Decision("new", cid, uh, th)
