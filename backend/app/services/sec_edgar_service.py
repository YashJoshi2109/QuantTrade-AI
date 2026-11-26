"""SEC EDGAR free API integration — CIK lookup, company facts, financial parsing, AI insights."""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import requests
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

USER_AGENT = "QuantTrade/1.0 yashjosh7486@gmail.com"
EDGAR_BASE = "https://data.sec.gov"
SEC_HEADERS = {"User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate"}
_CIK_CACHE: dict[str, str] = {}   # in-memory ticker→CIK cache
_CIK_CACHE_TS: float = 0.0


# ── CIK lookup ────────────────────────────────────────────────────────

def get_cik(ticker: str) -> Optional[str]:
    """Return zero-padded 10-digit CIK for ticker, or None if not found.
    Uses SEC's bulk ticker JSON (cached in memory 4 hours).
    """
    global _CIK_CACHE, _CIK_CACHE_TS
    ticker = ticker.upper().replace(".", "-")  # BRK-B handling
    if _CIK_CACHE and (time.time() - _CIK_CACHE_TS) < 14400:
        return _CIK_CACHE.get(ticker)

    try:
        resp = requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers=SEC_HEADERS, timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        _CIK_CACHE = {
            v["ticker"].upper(): str(v["cik_str"]).zfill(10)
            for v in data.values()
        }
        _CIK_CACHE_TS = time.time()
        logger.info("Loaded %d CIK mappings from SEC", len(_CIK_CACHE))
    except Exception as e:
        logger.warning("CIK fetch failed: %s", e)
    return _CIK_CACHE.get(ticker)


# ── S3 caching helpers ─────────────────────────────────────────────────

_S3 = None


def _s3_client():
    """One shared client with tight timeouts: boto3's defaults (60s connect +
    60s read, 4 retries) let one S3 hiccup hold a request thread for minutes."""
    global _S3
    if _S3 is None:
        import boto3
        from botocore.config import Config

        _S3 = boto3.client(
            "s3",
            config=Config(connect_timeout=3, read_timeout=15, retries={"max_attempts": 2, "mode": "standard"}),
        )
    return _S3

def _s3_get(key: str) -> Optional[dict]:
    """Return parsed JSON from S3 key, or None if missing/expired."""
    try:
        s3 = _s3_client()
        obj = s3.get_object(Bucket="quanttrade-ml-artifacts-208638972407", Key=key)
        return json.loads(obj["Body"].read())
    except Exception:
        return None


def _s3_put(key: str, data: dict) -> None:
    """Write JSON to S3 key."""
    try:
        s3 = _s3_client()
        s3.put_object(
            Bucket="quanttrade-ml-artifacts-208638972407",
            Key=key,
            Body=json.dumps(data).encode(),
            ContentType="application/json",
        )
    except Exception as e:
        logger.warning("S3 put failed for %s: %s", key, e)


def _is_stale(data: dict, max_age_hours: float) -> bool:
    """Check if cached data is stale based on _cached_at timestamp."""
    ts = data.get("_cached_at")
    if not ts:
        return True
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds() / 3600
    return age > max_age_hours


# ── Company facts (XBRL) ───────────────────────────────────────────────

def get_company_facts(cik: str, force_refresh: bool = False) -> Optional[dict]:
    """Fetch company facts JSON from EDGAR (S3-cached 24h)."""
    s3_key = f"edgar/company_facts/{cik}.json"

    if not force_refresh:
        cached = _s3_get(s3_key)
        if cached and not _is_stale(cached, max_age_hours=24):
            return cached

    time.sleep(0.12)  # SEC rate limit: max 10 req/sec
    try:
        resp = requests.get(
            f"{EDGAR_BASE}/api/xbrl/companyfacts/CIK{cik}.json",
            headers=SEC_HEADERS, timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        data["_cached_at"] = datetime.now(timezone.utc).isoformat()
        _s3_put(s3_key, data)
        return data
    except Exception as e:
        logger.warning("Company facts fetch failed for CIK %s: %s", cik, e)
        return None


def get_submissions(cik: str, force_refresh: bool = False) -> Optional[dict]:
    """Fetch submissions/filings list (S3-cached 24h)."""
    s3_key = f"edgar/submissions/{cik}.json"

    if not force_refresh:
        cached = _s3_get(s3_key)
        if cached and not _is_stale(cached, max_age_hours=24):
            return cached

    time.sleep(0.12)
    try:
        resp = requests.get(
            f"{EDGAR_BASE}/submissions/CIK{cik}.json",
            headers=SEC_HEADERS, timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        data["_cached_at"] = datetime.now(timezone.utc).isoformat()
        _s3_put(s3_key, data)
        return data
    except Exception as e:
        logger.warning("Submissions fetch failed for CIK %s: %s", cik, e)
        return None


# ── XBRL concept extraction ─────────────────────────────────────────────

# Map common XBRL tags to our field names
_INCOME_TAGS = {
    # Banks (e.g. JPM) report headline "total net revenue" as RevenuesNetOfInterestExpense;
    # no non-bank uses that tag, so listing it first is safe.
    "revenue": ["RevenuesNetOfInterestExpense", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
    "eps_basic": ["EarningsPerShareBasic"],
    "eps_diluted": ["EarningsPerShareDiluted"],
    "shares_basic": ["WeightedAverageNumberOfSharesOutstandingBasic"],
    "shares_diluted": ["WeightedAverageNumberOfDilutedSharesOutstanding"],
    "rd_expense": ["ResearchAndDevelopmentExpense"],
    "sga_expense": ["SellingGeneralAndAdministrativeExpense"],
    "ebitda": ["EarningsBeforeInterestTaxesDepreciationAndAmortization"],
}

_BALANCE_TAGS = {
    "total_assets": ["Assets"],
    "current_assets": ["AssetsCurrent"],
    "cash_and_equivalents": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsAndShortTermInvestments"],
    "total_liabilities": ["Liabilities"],
    "current_liabilities": ["LiabilitiesCurrent"],
    "long_term_debt": ["LongTermDebt", "LongTermDebtNoncurrent"],
    "stockholders_equity": ["StockholdersEquity", "StockholdersEquityAttributableToParent"],
    "retained_earnings": ["RetainedEarningsAccumulatedDeficit"],
    "goodwill": ["Goodwill"],
    "intangible_assets": ["FiniteLivedIntangibleAssetsNet", "IntangibleAssetsNetExcludingGoodwill"],
}

# Per-period fallbacks when no primary tag reports the period. Banks file an
# unclassified balance sheet with their own tags: JPM's last
# CashAndCashEquivalentsAtCarryingValue fact is 2018 and its last LongTermDebt
# fact is 2014, so cash and long-term debt came out blank for every recent
# period. Each source is a tuple of tags that must ALL report the period and
# are summed (bank cash = cash and due from banks + interest-bearing deposits
# with banks, which equals the cash-flow statement's cash total for JPM).
# Fed funds purchased / repos are secured funding, not debt, and are not used.
_BALANCE_FALLBACKS: dict[str, list[tuple[str, ...]]] = {
    "cash_and_equivalents": [
        ("CashAndDueFromBanks", "InterestBearingDepositsInBanks"),
        ("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",),
        ("CashAndDueFromBanks",),
    ],
    "long_term_debt": [
        ("LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",),
        ("LongTermDebtAndCapitalLeaseObligations",),
    ],
}

_CASHFLOW_TAGS = {
    "operating_cash_flow": ["NetCashProvidedByUsedInOperatingActivities"],
    "investing_cash_flow": ["NetCashProvidedByUsedInInvestingActivities"],
    "financing_cash_flow": ["NetCashProvidedByUsedInFinancingActivities"],
    "capital_expenditures": [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
        "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets",
    ],
    "dividends_paid": ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
    "share_repurchases": ["PaymentsForRepurchaseOfCommonStock"],
}

# Used only to derive EBITDA (= operating income + D&A) when no EBITDA tag exists.
_DA_TAGS = ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet"]

# Bump when parsing changes so rows stored by an older parser get re-synced.
PARSER_VERSION = 4  # 3: bank revenue tag + period discovery from revenue ∪ net income; 4: bank cash/debt fallbacks

_QUARTER_DAYS = (75, 105)
_ANNUAL_DAYS = (340, 390)


def _days(entry: dict) -> Optional[int]:
    start, end = entry.get("start"), entry.get("end")
    if not start or not end:
        return None
    try:
        return (datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")).days
    except ValueError:
        return None


def _extract_concept(facts_data: dict, tags: list[str], unit: str = "USD") -> list[dict]:
    """All entries for a concept, MERGED across alias tags.

    Companies switch tags over the years (NVDA capex moved from
    PaymentsToAcquirePropertyPlantAndEquipment to PaymentsToAcquireProductiveAssets),
    so stopping at the first tag that exists silently drops recent periods.
    Earlier tags win when two tags report the same (start, end).
    """
    us_gaap = facts_data.get("facts", {}).get("us-gaap", {})
    merged: dict[tuple, dict] = {}
    for priority, tag in enumerate(tags):
        for e in us_gaap.get(tag, {}).get("units", {}).get(unit, []):
            key = (e.get("start"), e.get("end"))
            cur = merged.get(key)
            if cur is None or (cur["_p"] == priority and e.get("filed", "") > cur.get("filed", "")):
                merged[key] = {**e, "_p": priority}
    return list(merged.values())


def _latest(entries: list[dict]) -> Optional[dict]:
    return max(entries, key=lambda e: e.get("filed", "")) if entries else None


def _in_range(entry: dict, bounds: tuple[int, int]) -> bool:
    d = _days(entry)
    return d is not None and bounds[0] <= d <= bounds[1]


def _duration_value(entries: list[dict], period_end: str, is_annual: bool, allow_ytd_diff: bool = True) -> Optional[float]:
    """Value covering exactly the period: a full year for 10-K, ~3 months for 10-Q.

    10-Qs report both the 3-month value and the year-to-date total with the same
    end date; picking by end date alone returned YTD sums (NVDA "Q2" revenue
    $177.84B instead of $96.22B). Cash-flow statements are YTD-only, so a quarter
    is derived as YTD(this quarter) − YTD(previous quarter) with the same start.
    """
    bounds = _ANNUAL_DAYS if is_annual else _QUARTER_DAYS
    at_end = [e for e in entries if e.get("end") == period_end and _days(e) is not None]
    direct = _latest([e for e in at_end if _in_range(e, bounds)])
    if direct:
        return direct["val"]
    if is_annual or not allow_ytd_diff:
        return None
    end_dt = datetime.strptime(period_end, "%Y-%m-%d")
    for ytd in sorted((e for e in at_end if _days(e) > bounds[1]), key=lambda e: e.get("filed", ""), reverse=True):
        prior = [
            e for e in entries
            if e.get("start") == ytd.get("start") and e.get("end") and e["end"] < period_end
            and 0 < (end_dt - datetime.strptime(e["end"], "%Y-%m-%d")).days <= bounds[1]
        ]
        p = _latest(prior)
        if p is not None:
            return ytd["val"] - p["val"]
    return None


def _value_for(entries: list[dict], period_end: str, is_annual: bool, allow_ytd_diff: bool = True) -> Optional[float]:
    """Duration concepts (income/cash flow) vs instant concepts (balance sheet)."""
    if not entries:
        return None
    if any(e.get("start") for e in entries):
        return _duration_value(entries, period_end, is_annual, allow_ytd_diff)
    m = _latest([e for e in entries if e.get("end") == period_end])
    return m["val"] if m else None


def _fmt(value, unit="USD") -> Optional[str]:
    """Serialize a numeric value + unit to JSON string for DB storage."""
    if value is None:
        return None
    return json.dumps({"value": value, "unit": unit, "pv": PARSER_VERSION})


def stored_parser_version(row) -> int:
    """Parser version that produced a FinancialStatement row (0 = before versioning)."""
    for field in ("revenue", "net_income", "total_assets", "operating_cash_flow"):
        raw = getattr(row, field, None)
        if raw:
            try:
                return int(json.loads(raw).get("pv", 0))
            except Exception:
                return 0
    return 0


def _discover_periods(facts_data: dict) -> list[dict]:
    """Reporting periods labelled with SEC's own fiscal year/period.

    The earliest filing reporting a period end is the filing *for* that period,
    so its fy/fp are the correct labels (later filings restate it as a
    comparative under their own fy). Calendar-month quarters mislabelled
    non-calendar fiscal years (NVDA FY ends late January).
    """
    # Raw entries (every filing's copy), NOT the de-duplicated merge: we need the
    # original filing's fy/fp, which comparatives in later filings overwrite.
    us_gaap = facts_data.get("facts", {}).get("us-gaap", {})
    def _raw(tags):
        return [e for t in tags for e in us_gaap.get(t, {}).get("units", {}).get("USD", [])]
    # Union with net income: a company's revenue tag can stop years before its
    # latest filing (JPM's generic "Revenues" ended 2014 in some filings), which
    # previously made a 12-year-old quarter look like the newest one.
    entries = _raw(_INCOME_TAGS["revenue"]) + _raw(_INCOME_TAGS["net_income"])
    first: dict[tuple, dict] = {}
    for e in entries:
        form = (e.get("form") or "").replace("/A", "")
        if form == "10-K":
            if e.get("fp") != "FY" or not _in_range(e, _ANNUAL_DAYS):
                continue
        elif form == "10-Q":
            if not _in_range(e, (_QUARTER_DAYS[0], 300)):  # quarter or YTD
                continue
        else:
            continue
        key = (e["end"], form)
        if key not in first or e.get("filed", "") < first[key].get("filed", ""):
            first[key] = e

    periods: dict[str, dict] = {}
    for (end, form), e in first.items():
        fy = int(e.get("fy") or end[:4])
        fp = e.get("fp") or ""
        if form == "10-K":
            label, fq = f"{fy}-FY", None
        elif len(fp) == 2 and fp[0] == "Q" and fp[1] in "123":
            fq = int(fp[1])
            label = f"{fy}-Q{fq}"
        else:
            continue
        periods.setdefault(label, {
            "period": label, "fiscal_year": fy, "fiscal_quarter": fq,
            "form": form, "period_end_date": end, "filed_date": e.get("filed", ""),
        })
    return sorted(periods.values(), key=lambda p: p["period_end_date"], reverse=True)


def _fallback_value(field: str, series, period_end: str, is_annual: bool) -> Optional[float]:
    """First fallback source (see _BALANCE_FALLBACKS) whose tags all report the period."""
    for source in _BALANCE_FALLBACKS.get(field, ()):
        parts = [_value_for(series([tag]), period_end, is_annual) for tag in source]
        if parts and all(p is not None for p in parts):
            return sum(parts)
    return None


def parse_financials(facts_data: dict, cik: str, symbol_id: int, ticker: str) -> list[dict]:
    """
    Parse EDGAR company_facts JSON into a list of FinancialStatement dicts.
    Returns up to 20 most recent periods (mix of annual + quarterly).
    """
    periods = _discover_periods(facts_data)[:20]

    series_cache: dict[tuple, list[dict]] = {}

    def series(tags: list[str], unit: str = "USD") -> list[dict]:
        key = (tuple(tags), unit)
        if key not in series_cache:
            series_cache[key] = _extract_concept(facts_data, tags, unit)
        return series_cache[key]

    def unit_for(field: str) -> str:
        if field in ("eps_basic", "eps_diluted"):
            return "USD/shares"
        if field in ("shares_basic", "shares_diluted"):
            return "shares"
        return "USD"

    results = []
    for p in periods:
        end = p["period_end_date"]
        annual = p["form"] == "10-K"
        row = {"cik": cik, "symbol_id": symbol_id, **p}
        vals: dict[str, Optional[float]] = {}

        for field, tags in _INCOME_TAGS.items():
            unit = unit_for(field)
            # Per-share and share-count values are not additive: never derive
            # a quarter by subtracting year-to-date figures.
            additive = unit == "USD"
            vals[field] = _value_for(series(tags, unit), end, annual, allow_ytd_diff=additive)
            row[field] = _fmt(vals[field], unit)

        for field, tags in _BALANCE_TAGS.items():
            vals[field] = _value_for(series(tags), end, annual)
            if vals[field] is None:
                vals[field] = _fallback_value(field, series, end, annual)
            row[field] = _fmt(vals[field])

        for field, tags in _CASHFLOW_TAGS.items():
            vals[field] = _value_for(series(tags), end, annual)
            row[field] = _fmt(vals[field])

        # EBITDA = operating income + D&A when the company doesn't tag EBITDA
        if vals.get("ebitda") is None and vals.get("operating_income") is not None:
            da = _value_for(series(_DA_TAGS), end, annual)
            if da is not None:
                row["ebitda"] = _fmt(vals["operating_income"] + da)

        ocf, capex = vals.get("operating_cash_flow"), vals.get("capital_expenditures")
        row["free_cash_flow"] = _fmt(ocf - capex) if ocf is not None and capex is not None else None

        results.append(row)

    return results


# ── Company overview extraction ────────────────────────────────────────

def parse_company_overview(facts_data: dict, submissions_data: dict, cik: str) -> dict:
    """Extract company overview from company_facts + submissions."""
    entity = facts_data.get("entityName", "")

    sic = str(submissions_data.get("sic", "") or "")
    sic_desc = submissions_data.get("sicDescription", "")
    state = submissions_data.get("stateOfIncorporation", "")
    fy_end = submissions_data.get("fiscalYearEnd", "")
    ein = submissions_data.get("ein", "")
    category = submissions_data.get("category", "")

    return {
        "cik": cik,
        "company_name": entity,
        "sic": sic,
        "sic_description": sic_desc,
        "state_of_incorporation": state,
        "fiscal_year_end": fy_end,
        "ein": ein,
        "category": category,
    }


# ── Filing list extraction ─────────────────────────────────────────────

def parse_filings_list(submissions_data: dict, form_types: list[str] = None, limit: int = 20) -> list[dict]:
    """Extract recent filings from submissions JSON."""
    if form_types is None:
        form_types = ["10-K", "10-Q", "8-K", "10-K/A", "10-Q/A"]

    recent = submissions_data.get("filings", {}).get("recent", {})
    if not recent:
        return []

    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    accessions = recent.get("accessionNumber", [])
    descriptions = recent.get("primaryDocument", [])
    period_ends = recent.get("reportDate", [])

    filings = []
    for i, form in enumerate(forms):
        if form not in form_types:
            continue
        acc = accessions[i].replace("-", "") if i < len(accessions) else ""
        cik_padded = submissions_data.get("cik", "").zfill(10)
        edgar_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik_padded)}/{acc}/{descriptions[i] if i < len(descriptions) else ''}" if acc else ""

        filings.append({
            "form_type": form,
            "filing_date": dates[i] if i < len(dates) else "",
            "period_end_date": period_ends[i] if i < len(period_ends) else "",
            "accession_number": accessions[i] if i < len(accessions) else "",
            "url": edgar_url,
            "description": f"{form} — {dates[i] if i < len(dates) else ''}",
        })
        if len(filings) >= limit:
            break

    return filings


# ── AI filing insights ─────────────────────────────────────────────────

INSIGHTS_PROMPT_VERSION = 1
INSIGHTS_CACHE_TTL_S = 7 * 86400


async def generate_filing_insights(
    ticker: str,
    financials: list[dict],
    filings: list[dict],
    company_info: dict,
    before_llm=None,
) -> str:
    """Generate AI insights on a company's filings using Claude.

    The prompt is fully determined by the filing data, so the result is cached
    (memory → Redis → ai_result_cache table, 7 days) by ticker + prompt hash:
    refreshes never re-bill.  On a cache miss `before_llm()` is called first —
    it may raise (quota / budget errors propagate) or return False to serve the
    rule-based fallback instead of calling the model.
    """

    # Build context from recent financials. Every line states its exact span so the
    # model never compares a 3-month quarter with a full fiscal year.
    def _val(f, field):
        try:
            v = json.loads(f.get(field) or "null")
            return v["value"] if v else None
        except Exception:
            return None

    def _money(v):
        if v is None:
            return "n/a"
        return f"${v/1e9:.2f}B" if abs(v) >= 1e8 else f"${v/1e6:.1f}M"

    fin_summary = []
    for f in (financials or [])[:12]:
        label = f.get("period", "?")
        fy, _, part = label.partition("-")
        span = "full fiscal year" if part == "FY" else "3-month quarter"
        name = f"FY{fy} {'annual' if part == 'FY' else part}"
        fields = [
            ("Revenue", "revenue"), ("Gross profit", "gross_profit"), ("Operating income", "operating_income"),
            ("Net income", "net_income"), ("OCF", "operating_cash_flow"), ("CapEx", "capital_expenditures"),
            ("FCF", "free_cash_flow"), ("Cash", "cash_and_equivalents"), ("Current assets", "current_assets"),
            ("Current liabilities", "current_liabilities"), ("Total liabilities", "total_liabilities"),
            ("Long-term debt", "long_term_debt"), ("Equity", "stockholders_equity"),
        ]
        parts = [f"{k} {_money(_val(f, key))}" for k, key in fields if _val(f, key) is not None]
        eps = _val(f, "eps_diluted")
        if eps is not None:
            parts.append(f"EPS (diluted) ${eps:.2f}")
        fin_summary.append(f"- {name} ({span}, ended {f.get('period_end_date', '?')}): " + "; ".join(parts))

    recent_filings = [f"{f['form_type']} filed {f['filing_date']}" for f in filings[:5]]

    prompt = f"""You are a senior equity analyst. Analyze {ticker} ({company_info.get('company_name', ticker)}) using only the SEC EDGAR data below.

Company: {company_info.get('company_name', ticker)}
Industry: {company_info.get('sic_description', 'N/A')}
Recent filings: {', '.join(recent_filings) or 'n/a'}

Financials (most recent first; fiscal-year labels follow the company's fiscal calendar):
{chr(10).join(fin_summary) if fin_summary else 'No financial data available'}

Rules:
- Compare like with like: quarter vs the same quarter a year earlier (YoY) or vs the prior quarter (QoQ); fiscal year vs prior fiscal year. Never compare a quarter with a full year.
- Use only the numbers given; if something is n/a, say it is not reported rather than guessing.

Write GitHub-flavored Markdown with exactly these four `###` headings, 2-3 sentences each, specific numbers where available:
### Revenue & Profitability
### Balance Sheet Health
### Cash Flow Quality
### Key Risks & Opportunities"""

    import asyncio as _asyncio
    from app.services import ai_guard
    from app.services.agentic.bedrock_client import get_llm_anthropic

    cache_key = f"sec_insights:v{INSIGHTS_PROMPT_VERSION}:{ticker.upper()}:" + ai_guard.cache_key(prompt)[:32]
    cached = await _asyncio.to_thread(ai_guard.cache_get, cache_key, persistent=True)
    if cached:
        return cached

    llm = get_llm_anthropic(max_tokens=800)
    if llm is None:
        return _fallback_insights(ticker, financials, company_info)
    if before_llm is not None and before_llm() is False:
        return _fallback_insights(ticker, financials, company_info)

    try:
        from langchain_core.messages import HumanMessage

        response = await llm.ainvoke([HumanMessage(content=prompt)])
        text = response.content if isinstance(response.content, str) else str(response.content)
    except ai_guard.AIQuotaError:
        raise
    except Exception as e:
        logger.warning("AI insight generation failed: %s", e)
        return _fallback_insights(ticker, financials, company_info)
    if text:
        await _asyncio.to_thread(ai_guard.cache_set, cache_key, text, INSIGHTS_CACHE_TTL_S, persistent=True)
    return text


def _fallback_insights(ticker: str, financials: list[dict], company_info: dict) -> str:
    """Rule-based fallback when Claude is unavailable."""
    if not financials:
        return f"No financial data available for {ticker} at this time."

    def _val(f, field):
        try:
            v = json.loads(f.get(field) or "null")
            return v["value"] if v else None
        except Exception:
            return None

    lines = [f"**{ticker} — {company_info.get('company_name', ticker)}**\n"]

    # Never mix spans: a fiscal year is only compared with the prior fiscal
    # year, and a quarter with the same quarter one year earlier. (Comparing a
    # 10-K year with a 10-Q quarter produced "+233%" revenue "growth".)
    def _span(f):
        p = str(f.get("period") or "")
        m = re.match(r"^(\d{4})-(FY|Q[1-4])$", p)
        if m:
            return int(m.group(1)), m.group(2)
        form = str(f.get("form") or "").upper()
        return None, ("FY" if form.startswith("10-K") else None)

    def _label(f):
        fy, span = _span(f)
        if fy is None:
            return "latest period"
        return f"FY{fy}" if span == "FY" else f"{span} FY{fy}"

    def _money(v):
        a = abs(v)
        s = f"${a/1e12:.2f}T" if a >= 1e12 else f"${a/1e9:.2f}B" if a >= 1e9 else f"${a/1e6:.1f}M"
        return f"-{s}" if v < 0 else s

    def _yoy(cur, prev):
        if cur is None or prev in (None, 0):
            return ""
        g = (cur - prev) / abs(prev) * 100
        return f" ({'+' if g >= 0 else ''}{g:.1f}% YoY)"

    annual = [f for f in financials if _span(f)[1] == "FY"]
    quarters = [f for f in financials if (_span(f)[1] or "").startswith("Q")]

    def _same_span_prior(rows, f):
        fy, span = _span(f)
        if fy is None:
            return None
        return next((r for r in rows if _span(r) == (fy - 1, span)), None)

    parts = []
    if annual:
        a = annual[0]
        prev = _same_span_prior(annual, a)
        rev = _val(a, "revenue")
        if rev:
            parts.append(f"{_label(a)} revenue {_money(rev)}{_yoy(rev, _val(prev, 'revenue') if prev else None)}")
        ni = _val(a, "net_income")
        if ni is not None:
            parts.append(f"net income {_money(ni)}{_yoy(ni, _val(prev, 'net_income') if prev else None)}")
    if quarters:
        q = quarters[0]
        prev = _same_span_prior(quarters, q)
        rev = _val(q, "revenue")
        if rev:
            parts.append(f"{_label(q)} revenue {_money(rev)}{_yoy(rev, _val(prev, 'revenue') if prev else None)}")
    if parts:
        lines.append("**Revenue & Profitability**: " + "; ".join(parts) + ".")

    # Cash flow from the same fiscal year as the revenue line when available
    cf_row = next((f for f in (annual or financials) if _val(f, "operating_cash_flow")), None)
    if cf_row:
        ocf = _val(cf_row, "operating_cash_flow")
        fcf = _val(cf_row, "free_cash_flow")
        lines.append(f"\n**Cash Flow ({_label(cf_row)})**: Operating cash flow {_money(ocf)}."
                     + (f" Free cash flow {_money(fcf)}." if fcf is not None else ""))

    lines.append("\n_Source: SEC 10-K/10-Q filings. Sign in for the full AI analysis._")
    return "\n".join(lines) if len(lines) > 2 else f"Financial data loaded for {ticker}. Sign in for the AI analysis."


# ── Main sync function ─────────────────────────────────────────────────

def sync_edgar_data(ticker: str, db: Session, force_refresh: bool = False) -> dict:
    """
    Full sync: fetch CIK → company facts → submissions → parse → upsert DB.
    Returns {"status": "ok"|"error", "message": str, "cik": str|None}
    """
    from app.models.edgar import CompanyEDGAR, FinancialStatement
    from app.models.symbol import Symbol
    from sqlalchemy import select

    # 1. Resolve symbol — Symbol model uses .symbol column (not .ticker)
    symbol = db.query(Symbol).filter(Symbol.symbol == ticker.upper()).first()
    if not symbol:
        return {"status": "error", "message": f"Symbol {ticker} not found in DB"}

    # 2. Get CIK
    cik = get_cik(ticker)
    if not cik:
        return {"status": "error", "message": f"CIK not found for {ticker}"}

    # 3. Fetch data
    facts_data = get_company_facts(cik, force_refresh=force_refresh)
    submissions_data = get_submissions(cik, force_refresh=force_refresh)

    if not facts_data:
        return {"status": "error", "message": f"Could not fetch EDGAR data for {ticker}"}

    # 4. Upsert CompanyEDGAR
    overview = parse_company_overview(facts_data, submissions_data or {}, cik)
    company_edgar = db.query(CompanyEDGAR).filter(CompanyEDGAR.symbol_id == symbol.id).first()
    if company_edgar:
        for k, v in overview.items():
            setattr(company_edgar, k, v)
    else:
        company_edgar = CompanyEDGAR(symbol_id=symbol.id, **overview)
        db.add(company_edgar)

    # 5. Parse + upsert financial statements
    financial_rows = parse_financials(facts_data, cik, symbol.id, ticker)
    upserted = 0
    if financial_rows:
        # Replace, don't merge: period labels can change between parser versions
        # (calendar → fiscal quarters), and stale labels would linger as duplicates.
        db.query(FinancialStatement).filter(FinancialStatement.symbol_id == symbol.id).delete(synchronize_session=False)
        for row in financial_rows:
            db.add(FinancialStatement(**row))
            upserted += 1

    db.commit()
    logger.info("Synced EDGAR data for %s: CIK=%s, %d periods, %d new", ticker, cik, len(financial_rows), upserted)
    return {"status": "ok", "cik": cik, "periods": len(financial_rows), "new_records": upserted}
