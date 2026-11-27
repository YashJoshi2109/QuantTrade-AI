"""Compliance gate every bot post passes before it is written.

Rules (see the PR description / bot profile pages):

1. Labelled: the body carries "Automated post by <BotName>", the data sources,
   the as-of time and the not-investment-advice disclaimer; the title carries
   the robot marker. The UI adds a bot badge on top of that.
2. No advice language: the copilot's policy filter regex (guarantees,
   "you should buy", "buy now", ...) plus a stricter bot list ("strong buy",
   "price target", "load up", ...). Bots describe *signals* and *observations*.
3. No third-party content beyond short headlines: at most MAX_LINKS links,
   each title clipped to MAX_HEADLINE_CHARS with an http(s) link back to the
   publisher. Links to social platforms / forums are refused (we never re-post
   other people's posts), and handles like @name or u/name are refused (we
   never name private users).
4. Size limits: title <= 300 chars (posts.title), body <= 40,000.
"""
from __future__ import annotations

import re
from typing import List
from urllib.parse import urlparse

from app.services.community_bots.base import (
    DISCLAIMER, MAX_HEADLINE_CHARS, MAX_LINKS, BotPost, BotSpec, render_body,
)
from app.services.copilot.postcheck import POLICY_RE

BOT_ADVICE_RE = re.compile(
    r"\b(you should|we recommend|i recommend|recommend(?:ed|s)? (?:buying|selling|shorting)|"
    r"strong (?:buy|sell)|buy (?:now|today|the dip)|sell (?:now|today)|price target|"
    r"load up|go all[- ]in|can'?t lose|sure thing|guaranteed|risk[- ]free|time to (?:buy|sell)|"
    r"must[- ]own|don'?t miss)\b",
    re.I,
)
HANDLE_RE = re.compile(r"(?<![\w/.])(?:@[A-Za-z0-9_]{2,}|/?u/[A-Za-z0-9_-]{3,})\b")
BLOCKED_LINK_DOMAINS = (
    "reddit.com", "redd.it", "stocktwits.com", "twitter.com", "x.com", "t.co", "facebook.com",
    "fb.com", "instagram.com", "threads.net", "tiktok.com", "discord.com", "discord.gg",
    "t.me", "telegram.org", "youtube.com", "youtu.be", "seekingalpha.com/instablog",
)
TITLE_MARKER = "\U0001F916"  # robot face
MAX_TITLE = 300
MAX_BODY = 40_000


def _domain_blocked(url: str) -> bool:
    try:
        p = urlparse(url)
    except ValueError:
        return True
    host = (p.hostname or "").lower()
    full = host + (p.path or "")
    for d in BLOCKED_LINK_DOMAINS:
        if "/" in d:
            if full.startswith(d) or full.endswith(d):
                return True
        elif host == d or host.endswith("." + d):
            return True
    return False


def _texts(post: BotPost) -> List[str]:
    """Every template-generated string in the post (link titles excluded)."""
    out = [post.title, post.lead, *post.highlights, *post.notes]
    for t in post.tables:
        out.append(str(t.get("title") or ""))
        out.extend(str(c) for c in t.get("columns") or [])
        for row in t.get("rows") or []:
            out.extend(str(c) for c in row)
    if post.chart:
        out.append(str(post.chart.get("title") or ""))
        out.extend(str(p.get("label")) for p in post.chart.get("series") or [])
    if post.badge:
        out.append(str(post.badge.get("label") or ""))
    return out


def validate(spec: BotSpec, post: BotPost, body: str) -> List[str]:
    """Return a list of violations; empty means the post may be published."""
    v: List[str] = []
    if not post.title.startswith(TITLE_MARKER):
        v.append("title must start with the robot marker")
    if len(post.title) > MAX_TITLE:
        v.append(f"title longer than {MAX_TITLE} chars")
    if len(body) > MAX_BODY:
        v.append(f"body longer than {MAX_BODY} chars")
    for label in (f"Automated post by {spec.display_name}", "Sources:", "As of:", DISCLAIMER):
        if label not in body:
            v.append(f"missing label: {label[:40]}")
    if not post.sources:
        v.append("no data sources listed")
    if post.as_of is None:
        v.append("no as-of time")

    for text in _texts(post):
        if BOT_ADVICE_RE.search(text) or POLICY_RE.search(text):
            v.append(f"advice/guarantee language: {text[:80]!r}")
        if HANDLE_RE.search(text):
            v.append(f"personal handle in text: {text[:80]!r}")

    if len(post.links) > MAX_LINKS:
        v.append(f"more than {MAX_LINKS} external links")
    for link in post.links:
        title, url = str(link.get("title") or ""), str(link.get("url") or "")
        if not title or len(title) > MAX_HEADLINE_CHARS:
            v.append(f"headline missing or longer than {MAX_HEADLINE_CHARS} chars")
        if "\n" in title:
            v.append("headline spans multiple lines")
        if not url.startswith(("https://", "http://")):
            v.append("headline without an http(s) link to the source")
        elif _domain_blocked(url):
            v.append(f"link to a social/forum platform is not allowed: {url[:60]}")
        if HANDLE_RE.search(title):
            v.append("personal handle in headline")
    return v


def check(spec: BotSpec, post: BotPost) -> List[str]:
    return validate(spec, post, render_body(spec, post))
