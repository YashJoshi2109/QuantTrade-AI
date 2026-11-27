"""Copilot tools over the free / public datasets (app.services.public_data).

Registered through the copilot tool registry (``tools.register_tool``) when
``app.services.copilot.tools`` is imported.  Each result is ONE
``PublicDataFact`` whose ``data`` is the deterministic payload the API serves
(attribution, as-of date, notes on lag/method included), so every number in an
answer is grounded in it.

Fact ids
  pub:insiders:NVDA            SEC Form 4 open-market buys/sells, net activity
  pub:13f:NVDA:2026-06-30      SEC 13F institutional ownership (quarter end)
  pub:short:NVDA               FINRA short interest + Reg SHO short volume (only if enabled)
  pub:curve:2026-11-25         US Treasury par yield curve + macro (FRED/BLS)
  pub:ff:NVDA:ff5:3y           Fama-French factor regression
  pub:lang:NVDA                filing language metrics (10-K / 10-Q)
  pub:pit:NVDA:2024-06-30      point-in-time fundamentals (SEC FSDS)
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple

from app.services.copilot.models import Fact

TIMEOUT_S = 40.0
_T = {"type": "string"}


class PublicDataFact(Fact):
    kind: Literal["public_data"] = "public_data"
    dataset: str
    data: Dict[str, Any]

    def label(self) -> str:
        a = self.data.get("attribution") or {}
        return f"{self.ticker or ''} {self.dataset} ({a.get('agency') or self.source})".strip()

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        d["snippet"] = (self.data.get("attribution") or {}).get("text")
        return d


def _sym(a: Dict[str, Any]) -> str:
    from app.services.copilot.resolver import normalize_symbol
    t = normalize_symbol(a.get("ticker") or "")
    if not t:
        raise LookupError("ticker is required")
    return t.replace(".", "-")


async def _db(fn):
    from app.services.public_data.service import with_db
    return await asyncio.to_thread(with_db, fn)


def _fact(fid: str, dataset: str, ticker: Optional[str], payload: Dict[str, Any], as_of: Optional[str]) -> PublicDataFact:
    a = payload.get("attribution") or {}
    return PublicDataFact(id=fid, source=a.get("text") or dataset, as_of=as_of, ticker=ticker, dataset=dataset,
                          data=payload)


def _need(payload: Dict[str, Any], what: str, ticker: Optional[str] = None) -> None:
    if payload.get("status") != "ok":
        reason = payload.get("reason") or payload.get("refresh_error") or (
            "still loading; ask again in a minute" if payload.get("syncing") else "not loaded")
        raise LookupError(f"{what}{' for ' + ticker if ticker else ''} unavailable: {reason}")


# ── handlers ────────────────────────────────────────────────────────────────

async def insider_activity(ex, a):
    from app.services.public_data import service
    from app.services.public_data.sec_form4 import insider_payload
    t = _sym(a)
    days = int(a.get("days") or 180)
    days = max(30, min(365, days))
    sync = await service.ensure("form4", t, 20.0)
    p = await _db(lambda db: insider_payload(db, t, days=days, limit=60))
    p["syncing"] = sync["syncing"]
    _need(p, "SEC Form 4 insider data", t)
    open_mkt = [x for x in p["transactions"] if x["code"] in ("P", "S") and not x["derivative"]][:15]
    other = [x for x in p["transactions"] if x not in open_mkt][:8]
    payload = {"ticker": t, "summary": p["summary"], "open_market_transactions": open_mkt,
               "other_transactions_sample": [{k: x[k] for k in ("date", "insider", "type", "shares")} for x in other],
               "latest_filing": p["latest_filing"], "notes": p["notes"], "attribution": p["attribution"]}
    return [_fact(f"pub:insiders:{t}", "SEC Form 4 insider transactions", t, payload, p["latest_filing"])], payload


async def institutional_ownership(ex, a):
    from app.services.public_data import service
    from app.services.public_data.sec_13f import ownership_payload
    t = _sym(a)
    top = max(1, min(25, int(a.get("top") or 10)))

    def run(db):
        out = ownership_payload(db, t, top=top)
        if out["status"] != "ok":
            service.request_bulk(db, t)
            out["reason"] = "13F data for this ticker is not loaded yet (queued for the next 13F data-set load)"
        return out
    p = await _db(run)
    _need(p, "SEC 13F institutional ownership", t)
    return [_fact(f"pub:13f:{t}:{p['period']}", "SEC 13F institutional ownership", t, p, p["period"])], p


async def short_interest(ex, a):
    from app.services.public_data import service
    from app.services.public_data.finra import short_payload
    from app.services.public_data.sources import disabled_payload, enabled
    t = _sym(a)
    if not enabled("finra_si"):
        raise LookupError("FINRA short interest is switched off: " + disabled_payload("finra_si")["reason"])
    sync = await service.ensure("finra_si", t, 15.0)
    p = await _db(lambda db: short_payload(db, t))
    p["syncing"] = sync["syncing"]
    _need(p, "FINRA short interest", t)
    as_of = (p.get("short_interest") or {}).get("settlement_date") or p["short_volume"].get("latest_date")
    return [_fact(f"pub:short:{t}", "FINRA short interest", t, p, as_of)], p


async def treasury_yield_curve(ex, a):
    from app.services.public_data import macro, service
    sync = await service.ensure("macro_curve", "UST", 10.0)

    def run(db):
        curve = macro.yield_curve(db, compare_days=(30, 365))
        ser = macro.series(db, ["DTB3", "CPIAUCSL", "UNRATE"], start=(date.today() - timedelta(days=500)).isoformat())
        return curve, ser
    curve, ser = await _db(run)
    curve["syncing"] = sync["syncing"]
    _need(curve, "US Treasury yield curve")
    macro_latest: Dict[str, Any] = {}
    for sid, d in ser.items():
        obs = d.get("observations") or []
        if not obs:
            continue
        item = {"label": d["label"], "latest": obs[-1], "source": d["source"]}
        if sid == "CPIAUCSL":
            last = obs[-1]["date"]
            base_date = f"{int(last[:4]) - 1}{last[4:]}"
            base = next((o for o in obs if o["date"] == base_date), None)
            if base and base["value"]:
                item["yoy_pct"] = round((obs[-1]["value"] / base["value"] - 1) * 100, 2)
        macro_latest[sid] = item
    payload = {**curve, "comparisons": [{"label": c["label"], "date": c["date"],
                                         "points": [{"tenor": p["tenor"], "yield_pct": p["yield_pct"]}
                                                    for p in c["points"]]} for c in curve.get("comparisons", [])],
               "macro": macro_latest}
    return [_fact(f"pub:curve:{curve['date']}", "US Treasury par yield curve", None, payload, curve["date"])], payload


async def factor_regression(ex, a):
    from app.services.public_data import macro, service
    from app.services.public_data.sources import attribution
    t = _sym(a)
    years = max(1.0, min(10.0, float(a.get("years") or 3)))
    model = "ff3" if (a.get("model") or "ff5").lower() == "ff3" else "ff5"
    end = datetime.now(timezone.utc).replace(tzinfo=None)
    start = end - timedelta(days=int(365.25 * years) + 10)

    def factors(db):
        df = macro.factor_frame(db, start.date().isoformat(), end.date().isoformat())
        if df.empty:
            macro.refresh_ff(db)
            df = macro.factor_frame(db, start.date().isoformat(), end.date().isoformat())
        return df
    fac = await _db(factors)
    if fac.empty:
        raise LookupError("Fama-French factors unavailable (Ken French data library not loaded)")

    def prices():
        from app.services.quant.data import get_provider
        return get_provider().prices(t, start, end)
    ps = await asyncio.to_thread(prices)
    if ps is None or ps.df is None or len(ps.df) < 60:
        raise LookupError(f"not enough daily price history for {t}")
    ret = ps.df["close"].astype(float).pct_change().dropna()
    ret.index = ret.index.tz_localize(None).normalize() if getattr(ret.index, "tz", None) else ret.index.normalize()
    res = await asyncio.to_thread(macro.factor_regression, ret, fac, model)
    payload = {"ticker": t, **res, "price_source": ps.source, "price_adjusted": ps.adjusted,
               "factor_data_through": fac.index[-1].date().isoformat(),
               "notes": ["Factor returns end when the Ken French library was last updated (monthly, ~1 month lag); "
                         "the regression window ends there."] + list(ps.warnings or [])[:3],
               "attribution": attribution("ff", fac.index[-1].date().isoformat(),
                                          extra="Fama-French 5 factors (2x3) daily")}
    fid = f"pub:ff:{t}:{model}:{int(years)}y"
    return [_fact(fid, f"Fama-French {model.upper()} regression", t, payload, payload["end"])], payload


async def filing_language_metrics(ex, a):
    from app.services.public_data import service
    from app.services.public_data.filing_language import language_payload
    t = _sym(a)
    sync = await service.ensure("filing_lang", t, 30.0)
    p = await _db(lambda db: language_payload(db, t, limit=int(a.get("limit") or 6)))
    p["syncing"] = sync["syncing"]
    _need(p, "filing language metrics", t)
    latest = p["filings"][0]["filed"] if p["filings"] else None
    return [_fact(f"pub:lang:{t}", "Filing language metrics", t, p, latest)], p


async def pit_fundamentals(ex, a):
    from app.services.public_data import service
    from app.services.public_data.sec_fsds import pit_values
    from app.services.public_data.sources import attribution
    t = _sym(a)
    as_of = (a.get("as_of") or "")[:10]
    try:
        date.fromisoformat(as_of)
    except ValueError:
        raise LookupError("as_of must be YYYY-MM-DD")
    tags = a.get("tags") or ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "NetIncomeLoss",
                             "EarningsPerShareDiluted", "Assets", "Liabilities", "StockholdersEquity",
                             "NetCashProvidedByUsedInOperatingActivities"]

    def run(db):
        vals = pit_values(db, t, as_of, list(tags)[:20])
        if not vals:
            service.request_bulk(db, t)
        return vals
    vals = await _db(run)
    if not vals:
        raise LookupError(f"no point-in-time SEC FSDS facts for {t} on or before {as_of} (not loaded yet)")
    latest = max(v["filed"] for v in vals.values())
    payload = {"ticker": t, "as_of": as_of, "values": vals,
               "notes": ["As originally filed in filings accepted on or before as_of (no look-ahead); "
                         "period ends rounded to month end by the SEC data set."],
               "attribution": attribution("sec_fsds", latest)}
    return [_fact(f"pub:pit:{t}:{as_of}", "SEC FSDS point-in-time fundamentals", t, payload, latest)], payload


SPECS: List[Tuple[Dict[str, Any], Any, str]] = [
    ({"name": "insider_activity",
      "description": ("SEC Form 4 insider transactions: open-market buys/sells, net insider activity (90/180/365d), "
                      "insiders, 10b5-1 plan sales, filing links."),
      "input_schema": {"type": "object", "properties": {"ticker": _T, "days": {"type": "integer", "minimum": 30,
                                                                             "maximum": 365}},
                       "required": ["ticker"], "additionalProperties": False}},
     insider_activity, "Reading SEC Form 4 filings for {ticker}"),
    ({"name": "institutional_ownership",
      "description": ("SEC 13F institutional ownership: holders count, total shares, top holders and quarter-over-"
                      "quarter change. Lagging (quarter end, filed up to 45 days later)."),
      "input_schema": {"type": "object", "properties": {"ticker": _T, "top": {"type": "integer", "minimum": 1,
                                                                            "maximum": 25}},
                       "required": ["ticker"], "additionalProperties": False}},
     institutional_ownership, "Reading SEC 13F holdings for {ticker}"),
    ({"name": "short_interest",
      "description": "FINRA short interest (bi-monthly, days to cover) and Reg SHO daily short-sale volume ratio.",
      "input_schema": {"type": "object", "properties": {"ticker": _T},
                       "required": ["ticker"], "additionalProperties": False}},
     short_interest, "Reading FINRA short interest for {ticker}"),
    ({"name": "treasury_yield_curve",
      "description": ("US Treasury daily par yield curve (1M-30Y) with 30d/1y-ago curves, 10y-2y and 10y-3m spreads, "
                      "T-bill, CPI YoY, unemployment (FRED/BLS)."),
      "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
     treasury_yield_curve, "Reading the US Treasury yield curve"),
    ({"name": "factor_regression",
      "description": ("Fama-French 3/5-factor regression of a stock's daily excess returns: market, size, value, "
                      "profitability, investment betas, t-stats, R2, annualised alpha."),
      "input_schema": {"type": "object", "properties": {"ticker": _T, "years": {"type": "number", "minimum": 1,
                                                                              "maximum": 10},
                                                       "model": {"type": "string", "enum": ["ff3", "ff5"]}},
                       "required": ["ticker"], "additionalProperties": False}},
     factor_regression, "Running a Fama-French regression for {ticker}"),
    ({"name": "filing_language_metrics",
      "description": ("10-K/10-Q text metrics: length, Fog/Flesch readability, tone word counts, and cosine "
                      "similarity of risk factors and MD&A vs the prior filing."),
      "input_schema": {"type": "object", "properties": {"ticker": _T, "limit": {"type": "integer", "minimum": 1,
                                                                              "maximum": 12}},
                       "required": ["ticker"], "additionalProperties": False}},
     filing_language_metrics, "Measuring filing language for {ticker}"),
    ({"name": "pit_fundamentals",
      "description": ("Point-in-time fundamentals as originally filed and known on a past date (SEC Financial "
                      "Statement Data Sets): no look-ahead, for backtests."),
      "input_schema": {"type": "object", "properties": {"ticker": _T, "as_of": {"type": "string",
                                                                              "description": "YYYY-MM-DD"},
                                                       "tags": {"type": "array", "items": {"type": "string"},
                                                                "maxItems": 20}},
                       "required": ["ticker", "as_of"], "additionalProperties": False}},
     pit_fundamentals, "Reading point-in-time SEC fundamentals for {ticker}"),
]
TOOL_NAMES = {s["name"] for s, _, _ in SPECS}


def register() -> None:
    from app.services.copilot.tools import register_tool
    for spec, handler, progress in SPECS:
        register_tool(spec, handler, timeout_s=TIMEOUT_S, progress=progress)
