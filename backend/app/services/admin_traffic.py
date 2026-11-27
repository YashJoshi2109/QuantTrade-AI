"""
Google Analytics 4 (Data API v1beta) and Search Console (searchAnalytics.query)
for the admin Traffic page. Plain REST over google-auth (already a dependency).

Configuration (env / AWS Secrets Manager quanttrade/backend):
  GA4_PROPERTY_ID           numeric GA4 property id (not the G-XXXX measurement id)
  GSC_SITE_URL              "sc-domain:quanttrade.us" or "https://www.quanttrade.us/"
  GOOGLE_ANALYTICS_SA_JSON  service-account key JSON (never logged, never returned)

The service account must be added as a Viewer on the GA4 property and as a
(restricted) user on the Search Console property.

Responses are cached in-process: reports 15 min, realtime 60 s.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import date, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/analytics.readonly",
          "https://www.googleapis.com/auth/webmasters.readonly"]
GA_BASE = "https://analyticsdata.googleapis.com/v1beta"
GSC_BASE = "https://searchconsole.googleapis.com/webmasters/v3"
REPORT_TTL_S = 15 * 60
REALTIME_TTL_S = 60
RANGE_DAYS = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}

SETUP_STEPS = [
    "In Google Cloud, create a service account (no roles needed) and a JSON key for it.",
    "Enable the 'Google Analytics Data API' and the 'Google Search Console API' for that project.",
    "GA4 Admin > Property access management: add the service-account email as Viewer.",
    "Search Console > Settings > Users and permissions: add the service-account email (Restricted).",
    "Store the key JSON in AWS Secrets Manager quanttrade/backend as GOOGLE_ANALYTICS_SA_JSON.",
    "Set GA4_PROPERTY_ID (GA4 Admin > Property details > Property ID, digits only) and GSC_SITE_URL.",
    "Redeploy (or restart the backend) so the secrets are loaded.",
]

_cache: Dict[str, Tuple[float, Any]] = {}
_cache_lock = threading.Lock()
_session_lock = threading.Lock()
_session: Any = None
_session_key: Optional[str] = None

# Tests replace this: fn(method, url, json_body) -> dict
Transport = Callable[[str, str, Optional[dict]], dict]
_transport_override: Optional[Transport] = None


def set_transport(fn: Optional[Transport]) -> None:
    global _transport_override
    _transport_override = fn
    clear_cache()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _env(name: str) -> str:
    v = os.getenv(name)
    if v is None:
        try:
            from app.config import settings
            v = getattr(settings, name, None)
        except Exception:  # noqa: BLE001
            v = None
    return (v or "").strip()


def config_status() -> Dict[str, Any]:
    sa = _env("GOOGLE_ANALYTICS_SA_JSON")
    sa_ok, sa_email = False, None
    if sa:
        try:
            info = json.loads(sa)
            sa_ok = bool(info.get("client_email") and info.get("private_key"))
            sa_email = info.get("client_email")
        except Exception:  # noqa: BLE001
            sa_ok = False
    prop = _env("GA4_PROPERTY_ID")
    site = _env("GSC_SITE_URL")
    return {
        "ga4_configured": sa_ok and prop.isdigit(),
        "gsc_configured": sa_ok and bool(site),
        "service_account_present": bool(sa),
        "service_account_valid": sa_ok,
        "service_account_email": sa_email,  # an identifier, not a secret; shown so it can be granted access
        "ga4_property_id_set": bool(prop),
        "ga4_property_id_valid": prop.isdigit() if prop else False,
        "gsc_site_url": site or None,
        "measurement_id": "G-7X19HSHVQD",
        "env": ["GA4_PROPERTY_ID", "GSC_SITE_URL", "GOOGLE_ANALYTICS_SA_JSON"],
        "setup_steps": SETUP_STEPS,
    }


def _authed_session():
    global _session, _session_key
    raw = _env("GOOGLE_ANALYTICS_SA_JSON")
    with _session_lock:
        if _session is not None and _session_key == raw:
            return _session
        from google.auth.transport.requests import AuthorizedSession
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=SCOPES)
        _session, _session_key = AuthorizedSession(creds), raw
        return _session


class TrafficError(RuntimeError):
    pass


def _call(method: str, url: str, body: Optional[dict]) -> dict:
    if _transport_override is not None:
        return _transport_override(method, url, body)
    s = _authed_session()
    r = s.request(method, url, json=body, timeout=20)
    if r.status_code >= 400:
        try:
            msg = (r.json().get("error") or {}).get("message") or r.reason
        except Exception:  # noqa: BLE001
            msg = r.reason
        raise TrafficError(f"Google API {r.status_code}: {str(msg)[:200]}")
    return r.json()


def _cached(key: str, ttl: int, fn: Callable[[], Any]) -> Any:
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _cache_lock:
        _cache[key] = (now, val)
    return val


def _dates(range_key: str) -> Tuple[str, str]:
    days = RANGE_DAYS.get(range_key, 30)
    end = date.today()
    start = end - timedelta(days=days - 1) if days > 1 else end - timedelta(days=1)
    return start.isoformat(), end.isoformat()


# ── GA4 ──────────────────────────────────────────────────────────────────────

def _ga_report(prop: str, body: dict) -> dict:
    return _call("POST", f"{GA_BASE}/properties/{prop}:runReport", body)


def _rows(resp: dict) -> List[Dict[str, Any]]:
    dims = [d["name"] for d in resp.get("dimensionHeaders", [])]
    mets = [m["name"] for m in resp.get("metricHeaders", [])]
    out = []
    for r in resp.get("rows", []) or []:
        row: Dict[str, Any] = {}
        for n, v in zip(dims, r.get("dimensionValues", [])):
            row[n] = v.get("value")
        for n, v in zip(mets, r.get("metricValues", [])):
            try:
                f = float(v.get("value"))
                row[n] = int(f) if f.is_integer() else f
            except (TypeError, ValueError):
                row[n] = None
        out.append(row)
    return out


def ga4_overview(range_key: str) -> Dict[str, Any]:
    prop = _env("GA4_PROPERTY_ID")
    start, end = _dates(range_key)
    dr = [{"startDate": start, "endDate": end}]

    def run():
        kpi = _rows(_ga_report(prop, {"dateRanges": dr, "metrics": [
            {"name": n} for n in ("activeUsers", "newUsers", "sessions", "screenPageViews",
                                  "averageSessionDuration", "userEngagementDuration", "engagementRate", "bounceRate")]}))
        daily = _rows(_ga_report(prop, {"dateRanges": dr, "dimensions": [{"name": "date"}],
                                        "metrics": [{"name": "activeUsers"}, {"name": "sessions"},
                                                    {"name": "screenPageViews"}],
                                        "orderBys": [{"dimension": {"dimensionName": "date"}}]}))

        def top(dim: List[str], metric: str, limit: int = 10, extra: Optional[List[str]] = None):
            return _rows(_ga_report(prop, {"dateRanges": dr, "dimensions": [{"name": d} for d in dim],
                                           "metrics": [{"name": metric}] + [{"name": m} for m in (extra or [])],
                                           "orderBys": [{"metric": {"metricName": metric}, "desc": True}],
                                           "limit": limit}))

        k = kpi[0] if kpi else {}
        users = k.get("activeUsers") or 0
        return {
            "range": range_key, "start": start, "end": end,
            "kpis": {
                "active_users": k.get("activeUsers"), "new_users": k.get("newUsers"),
                "sessions": k.get("sessions"), "page_views": k.get("screenPageViews"),
                "avg_engagement_time_s": round(k["userEngagementDuration"] / users, 1)
                if users and k.get("userEngagementDuration") is not None else None,
                "avg_session_duration_s": k.get("averageSessionDuration"),
                "engagement_rate": k.get("engagementRate"), "bounce_rate": k.get("bounceRate"),
            },
            "daily": [{"date": f"{r['date'][:4]}-{r['date'][4:6]}-{r['date'][6:]}", "users": r.get("activeUsers"),
                       "sessions": r.get("sessions"), "page_views": r.get("screenPageViews")} for r in daily],
            "top_pages": top(["pagePath"], "screenPageViews", 15, ["activeUsers"]),
            "channels": top(["sessionDefaultChannelGroup"], "sessions", 10),
            "sources": top(["sessionSourceMedium"], "sessions", 10),
            "countries": top(["country"], "activeUsers", 10),
            "devices": top(["deviceCategory"], "activeUsers", 5),
            "new_vs_returning": top(["newVsReturning"], "activeUsers", 5),
        }

    return _cached(f"ga4:{prop}:{range_key}", REPORT_TTL_S, run)


def ga4_realtime() -> Dict[str, Any]:
    prop = _env("GA4_PROPERTY_ID")

    def run():
        resp = _call("POST", f"{GA_BASE}/properties/{prop}:runRealtimeReport",
                     {"metrics": [{"name": "activeUsers"}]})
        rows = _rows(resp)
        return {"active_users_30m": rows[0].get("activeUsers") if rows else 0}

    return _cached(f"ga4rt:{prop}", REALTIME_TTL_S, run)


# ── Search Console ───────────────────────────────────────────────────────────

def gsc_overview(range_key: str) -> Dict[str, Any]:
    site = _env("GSC_SITE_URL")
    start, end = _dates(range_key)
    url = f"{GSC_BASE}/sites/{quote(site, safe='')}/searchAnalytics/query"

    def q(dims: List[str], limit: int) -> List[Dict[str, Any]]:
        resp = _call("POST", url, {"startDate": start, "endDate": end, "dimensions": dims, "rowLimit": limit})
        out = []
        for r in resp.get("rows", []) or []:
            row = {d: k for d, k in zip(dims, r.get("keys", []))}
            row.update({"clicks": r.get("clicks"), "impressions": r.get("impressions"),
                        "ctr": r.get("ctr"), "position": r.get("position")})
            out.append(row)
        return out

    def run():
        daily = q(["date"], 500)
        clicks = sum(r["clicks"] or 0 for r in daily)
        impr = sum(r["impressions"] or 0 for r in daily)
        pos = (sum((r["position"] or 0) * (r["impressions"] or 0) for r in daily) / impr) if impr else None
        return {
            "range": range_key, "start": start, "end": end, "site": site,
            "totals": {"clicks": clicks, "impressions": impr, "ctr": (clicks / impr) if impr else None,
                       "position": round(pos, 2) if pos is not None else None},
            "daily": sorted(daily, key=lambda r: r.get("date") or ""),
            "top_queries": q(["query"], 15),
            "top_pages": q(["page"], 15),
        }

    return _cached(f"gsc:{site}:{range_key}", REPORT_TTL_S, run)
