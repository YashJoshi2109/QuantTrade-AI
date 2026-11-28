"""
Story image extraction: pure functions, no network.

  entry_image(entry)        feedparser entry -> best image URL in the feed item
  alpaca_image(msg)         Alpaca/Benzinga stream message -> image URL
  page_image(html, base)    article HTML <head> -> og:image / twitter:image
  page_logo(html, base)     site home page <head> -> apple-touch-icon / large icon
  aggregator_image(e, pub)  Google News entry -> image only if hosted by the
                            publisher or a feed-supplied lh*.googleusercontent thumb
  normalize_image_url(u)    absolute https URL, or None for junk/trackers

Feed locations checked, best first: media:content (largest width, image
medium/type only; media:group children are flattened by feedparser),
media:thumbnail, enclosure (type image/*), itunes:image, then the first
reasonably sized <img> in content:encoded / description.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlsplit

_IMAGE_EXT = re.compile(r"\.(?:jpe?g|png|webp|gif|avif)(?:$|[?#])", re.I)
_NON_IMAGE_EXT = re.compile(r"\.(?:mp4|m4v|mov|webm|mp3|m4a|wav|pdf|svgz?)(?:$|[?#])", re.I)

# Tracking pixels, spacers, share buttons, ad beacons.
_TRACKER = re.compile(
    r"(?:/pixel(?:\.gif|\.png|/|\?|$)|tracking[-_]?pixel|/track(?:ing)?/|beacon|spacer\.gif|blank\.gif|"
    r"\b1x1\b|clear\.gif|transparent\.(?:gif|png)|"
    r"feedburner\.com|feeds\.feedburner|doubleclick\.net|/ad[sx]?/|adserver|"
    r"stats\.wp\.com|gravatar\.com/avatar|emoji|/share[-_]?button|/icons?/|favicon)",
    re.I,
)

# Site-wide placeholder images that say nothing about the story. A story
# with one of these is treated as having no image so the UI shows the
# designed fallback instead of the same logo on every card.
_GENERIC = re.compile(
    r"(?:yahoo_default_logo|default[-_]?(?:image|logo|share|og|thumb)|placeholder|"
    r"no[-_]?image|og[-_]default|social[-_]default|site[-_]logo|logo[-_]default|"
    r"/brand/|share[-_]?image[-_]?default|meta[-_]image\.|/logos?/)",
    re.I,
)

MIN_DIMENSION = 100  # px; smaller declared images are icons/logos/pixels


def _int(v: Any) -> int:
    try:
        return int(float(str(v).strip().rstrip("px")))
    except (TypeError, ValueError):
        return 0


def normalize_image_url(url: Optional[str], base: Optional[str] = None) -> Optional[str]:
    """Absolute https image URL or None. http is upgraded (an http image is
    blocked as mixed content on the https site anyway)."""
    if not url or not isinstance(url, str):
        return None
    u = url.strip().replace("&amp;", "&")
    if not u or u.startswith("data:") or len(u) > 2048:
        return None
    if u.startswith("//"):
        u = "https:" + u
    elif base and not re.match(r"^[a-z][a-z0-9+.-]*:", u, re.I):
        u = urljoin(base, u)
    parts = urlsplit(u)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    if parts.username or parts.password:
        return None
    if parts.scheme == "http":
        u = "https" + u[4:]
    if _TRACKER.search(u) or _NON_IMAGE_EXT.search(parts.path):
        return None
    return u


# File names that are a site's share card, not a story photo (".../fb.png").
_GENERIC_STEMS = {
    "fb", "og", "share", "social", "facebook", "twitter", "logo", "default", "og-image", "ogimage",
    "og_image", "opengraph", "opengraph-image", "meta", "meta-image", "share-image", "social-share",
    "apple-touch-icon", "icon",
}


def is_generic_image(url: Optional[str]) -> bool:
    if not url:
        return False
    if _GENERIC.search(url):
        return True
    path = urlsplit(url).path.rstrip("/")
    stem = path.rsplit("/", 1)[-1].rsplit(".", 1)[0].lower()
    return stem in _GENERIC_STEMS


def _looks_like_image(url: str, mime: str = "", medium: str = "") -> bool:
    medium = (medium or "").lower()
    mime = (mime or "").lower()
    if medium and medium != "image":
        return False
    if mime and not mime.startswith("image/"):
        return False
    if medium == "image" or mime.startswith("image/"):
        return True
    # No declared type: accept image extensions and extension-less CDN URLs.
    return bool(_IMAGE_EXT.search(url)) or not _NON_IMAGE_EXT.search(urlsplit(url).path)


def _too_small(width: int, height: int) -> bool:
    return (0 < width < MIN_DIMENSION) or (0 < height < MIN_DIMENSION)


# ── <img> in HTML fragments ─────────────────────────────────────────────

class _ImgCollector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.imgs: List[Dict[str, str]] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "img":
            self.imgs.append({k.lower(): (v or "") for k, v in attrs})

    handle_startendtag = handle_starttag


def html_first_image(fragment: Optional[str], base: Optional[str] = None) -> Optional[str]:
    """First <img> in an HTML fragment that is not a tracker/icon (declared
    size >= MIN_DIMENSION when the size is given)."""
    if not fragment or "<img" not in fragment.lower():
        return None
    p = _ImgCollector()
    try:
        p.feed(fragment)
        p.close()
    except Exception:
        return None
    for a in p.imgs:
        src = a.get("src") or a.get("data-src") or a.get("data-lazy-src") or ""
        if not src and a.get("srcset"):
            src = a["srcset"].split(",")[0].strip().split(" ")[0]
        if _too_small(_int(a.get("width")), _int(a.get("height"))):
            continue
        u = normalize_image_url(src, base)
        if u and not is_generic_image(u):
            return u
    return None


# ── feedparser entries ──────────────────────────────────────────────────

def _media_candidates(items: Iterable[Any]) -> List[Tuple[int, str]]:
    out: List[Tuple[int, str]] = []
    for m in items or []:
        if not isinstance(m, dict):
            continue
        url = m.get("url") or m.get("href")
        u = normalize_image_url(url)
        if not u or not _looks_like_image(u, m.get("type", ""), m.get("medium", "")):
            continue
        w, h = _int(m.get("width")), _int(m.get("height"))
        if _too_small(w, h):
            continue
        out.append((w * max(h, 1) if h else w, u))
    return out


def entry_image(entry: Any) -> Optional[str]:
    """Best image for one feedparser entry, or None."""
    get = entry.get if hasattr(entry, "get") else (lambda k, d=None: d)
    link = get("link") or None

    # media:content (and media:group children): largest declared size wins.
    cands = _media_candidates(get("media_content") or [])
    if cands:
        cands.sort(key=lambda t: t[0], reverse=True)
        for _, u in cands:
            if not is_generic_image(u):
                return u

    for _, u in _media_candidates(get("media_thumbnail") or []):
        if not is_generic_image(u):
            return u

    encl = list(get("enclosures") or [])
    encl += [l for l in (get("links") or []) if isinstance(l, dict) and l.get("rel") == "enclosure"]
    for e in encl:
        if not isinstance(e, dict):
            continue
        mime = (e.get("type") or "").lower()
        u = normalize_image_url(e.get("href") or e.get("url"))
        if u and mime.startswith("image/") and not is_generic_image(u):
            return u

    itunes = get("image") or get("itunes_image")
    if isinstance(itunes, dict):
        u = normalize_image_url(itunes.get("href") or itunes.get("url"))
        if u and not is_generic_image(u):
            return u

    for c in get("content") or []:
        value = c.get("value") if isinstance(c, dict) else None
        u = html_first_image(value, link)
        if u:
            return u
    return html_first_image(get("summary") or get("description"), link)


# ── Alpaca / Benzinga ───────────────────────────────────────────────────

_ALPACA_SIZE_ORDER = {"large": 0, "small": 1, "thumb": 2}


def alpaca_image(msg: Dict[str, Any]) -> Optional[str]:
    """Alpaca news messages may carry images=[{size: large|small|thumb, url}]
    and HTML `content`; take the largest image, then the first <img>."""
    imgs = [i for i in (msg.get("images") or []) if isinstance(i, dict) and i.get("url")]
    imgs.sort(key=lambda i: _ALPACA_SIZE_ORDER.get(str(i.get("size") or "").lower(), 3))
    for i in imgs:
        u = normalize_image_url(i["url"])
        if u and not is_generic_image(u):
            return u
    return html_first_image(msg.get("content"), msg.get("url") or None)


# ── article pages (og:image) ────────────────────────────────────────────

_META_KEYS = ("og:image:secure_url", "og:image:url", "og:image", "twitter:image", "twitter:image:src")


class _HeadMeta(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: Dict[str, str] = {}
        self.link_image: Optional[str] = None
        self.done = False

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        t = tag.lower()
        a = {k.lower(): (v or "") for k, v in attrs}
        if t == "meta":
            key = (a.get("property") or a.get("name") or a.get("itemprop") or "").strip().lower()
            if key == "image":  # schema.org itemprop
                key = "itemprop:image"
            val = a.get("content", "").strip()
            if key and val and key not in self.meta:
                self.meta[key] = val
        elif t == "link" and "image_src" in (a.get("rel") or "").lower() and a.get("href"):
            self.link_image = self.link_image or a["href"]
        elif t == "body":
            self.done = True

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag):
        if tag.lower() == "head":
            self.done = True


def page_image(html_text: str, base_url: Optional[str] = None) -> Optional[str]:
    """og:image / twitter:image / image_src from an article page head."""
    if not html_text:
        return None
    p = _HeadMeta()
    try:
        p.feed(html_text)
    except Exception:
        pass
    for k in _META_KEYS + ("itemprop:image",):
        u = normalize_image_url(p.meta.get(k), base_url)
        if u and not is_generic_image(u):
            w = _int(p.meta.get("og:image:width"))
            h = _int(p.meta.get("og:image:height"))
            if k.startswith("og:") and _too_small(w, h):
                continue
            return u
    u = normalize_image_url(p.link_image, base_url)
    return u if u and not is_generic_image(u) else None


# ── aggregator (Google News) entries ────────────────────────────────────

_GOOGLE_THUMB_HOST = re.compile(r"^lh\d*\.googleusercontent\.com$", re.I)


def site_domain(url_or_host: Optional[str]) -> str:
    """'https://www.wsj.com/x' -> 'wsj.com' (lower case, leading www. dropped)."""
    if not url_or_host:
        return ""
    host = url_or_host
    if "/" in url_or_host or ":" in url_or_host:
        try:
            host = urlsplit(url_or_host).hostname or ""
        except ValueError:
            return ""
    host = host.strip().rstrip(".").lower()
    return host[4:] if host.startswith("www.") else host


def host_in_domain(host: Optional[str], domain: str) -> bool:
    host = site_domain(host)
    return bool(host and domain) and (host == domain or host.endswith("." + domain))


def aggregator_image(entry: Any, publisher_url: Optional[str],
                     publisher_cdns: Iterable[str] = ()) -> Optional[str]:
    """Image carried by an aggregator (Google News) entry itself. Accepted only
    when hosted by the entry's own publisher (<source url> domain, or one of
    that publisher's declared image CDNs) or a Google thumbnail
    (lh*.googleusercontent.com) the feed put in the entry. Anything else
    (Google's logo, a third party's image) is ignored. Nothing is fetched."""
    u = entry_image(entry)
    if not u:
        return None
    host = urlsplit(u).hostname or ""
    if _GOOGLE_THUMB_HOST.match(host):
        return u
    pub = site_domain(publisher_url)
    if pub and pub != "news.google.com" and any(host_in_domain(host, d) for d in (pub, *publisher_cdns)):
        return u
    return None


# ── publisher logos (home page <head>) ──────────────────────────────────

LOGO_MIN = 96  # px; smaller declared icons are favicons that blur on a tile


def normalize_logo_url(url: Optional[str], base: Optional[str] = None) -> Optional[str]:
    """Absolute https URL for a logo/icon. Unlike story images, icon paths and
    SVG are fine here (an <img> never runs SVG scripts)."""
    if not url or not isinstance(url, str):
        return None
    u = url.strip().replace("&amp;", "&")
    if not u or u.startswith("data:") or len(u) > 2048:
        return None
    if u.startswith("//"):
        u = "https:" + u
    elif base and not re.match(r"^[a-z][a-z0-9+.-]*:", u, re.I):
        u = urljoin(base, u)
    parts = urlsplit(u)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        return None
    if parts.scheme == "http":
        u = "https" + u[4:]
    return u


def _icon_size(sizes: str) -> int:
    best = 0
    for tok in (sizes or "").lower().split():
        if tok == "any":
            return 512
        m = re.match(r"^(\d+)x(\d+)$", tok)
        if m:
            best = max(best, min(int(m.group(1)), int(m.group(2))))
    return best


class _HeadIcons(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: List[Dict[str, str]] = []
        self.meta: Dict[str, str] = {}
        self.done = False

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        t = tag.lower()
        a = {k.lower(): (v or "") for k, v in attrs}
        if t == "link" and a.get("href"):
            self.links.append(a)
        elif t == "meta":
            key = (a.get("property") or a.get("name") or a.get("itemprop") or "").strip().lower()
            if key and a.get("content") and key not in self.meta:
                self.meta[key] = a["content"].strip()
        elif t == "body":
            self.done = True

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag):
        if tag.lower() == "head":
            self.done = True


def page_logo(html_text: str, base_url: Optional[str] = None) -> Optional[str]:
    """Best square brand mark from a home page head: apple-touch-icon (largest),
    then an SVG or large (>= LOGO_MIN px) rel=icon, then og:logo /
    msapplication-TileImage. Small favicons are not used (they blur)."""
    if not html_text:
        return None
    p = _HeadIcons()
    try:
        p.feed(html_text)
    except Exception:
        pass
    cands: List[Tuple[int, str]] = []
    for a in p.links:
        rel = (a.get("rel") or "").lower().split()
        href = a.get("href", "")
        size = _icon_size(a.get("sizes", ""))
        is_svg = (a.get("type") or "").lower() == "image/svg+xml" or urlsplit(href).path.lower().endswith(".svg")
        if "apple-touch-icon" in rel or "apple-touch-icon-precomposed" in rel:
            cands.append((3000 + (size or 180), href))
        elif "icon" in rel:
            if is_svg:
                cands.append((2000, href))
            elif size >= LOGO_MIN:
                cands.append((1000 + size, href))
    for key in ("og:logo", "msapplication-tileimage"):
        if p.meta.get(key):
            cands.append((500, p.meta[key]))
    cands.sort(key=lambda t: t[0], reverse=True)
    for _, href in cands:
        u = normalize_logo_url(href, base_url)
        if u:
            return u
    return None
