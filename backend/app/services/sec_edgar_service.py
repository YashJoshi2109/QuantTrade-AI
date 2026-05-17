"""SEC EDGAR free API integration — CIK lookup, company facts, financial parsing, AI insights."""
from __future__ import annotations

import json
import logging
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

def _s3_get(key: str) -> Optional[dict]:
    """Return parsed JSON from S3 key, or None if missing/expired."""
    try:
        import boto3, botocore
        s3 = boto3.client("s3")
        obj = s3.get_object(Bucket="quanttrade-ml-artifacts", Key=key)
        return json.loads(obj["Body"].read())
    except Exception:
        return None


def _s3_put(key: str, data: dict) -> None:
    """Write JSON to S3 key."""
    try:
        import boto3
        s3 = boto3.client("s3")
        s3.put_object(
            Bucket="quanttrade-ml-artifacts",
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
    "revenue": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
    "eps_basic": ["EarningsPerShareBasic"],
    "eps_diluted": ["EarningsPerShareDiluted"],
    "shares_basic": ["CommonStockSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"],
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

_CASHFLOW_TAGS = {
    "operating_cash_flow": ["NetCashProvidedByUsedInOperatingActivities"],
    "investing_cash_flow": ["NetCashProvidedByUsedInInvestingActivities"],
    "financing_cash_flow": ["NetCashProvidedByUsedInFinancingActivities"],
    "capital_expenditures": ["PaymentsToAcquirePropertyPlantAndEquipment"],
    "dividends_paid": ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
    "share_repurchases": ["PaymentsForRepurchaseOfCommonStock"],
}


def _extract_concept(facts_data: dict, tags: list[str], unit: str = "USD") -> list[dict]:
    """Extract time-series values for a concept from company_facts JSON."""
    us_gaap = facts_data.get("facts", {}).get("us-gaap", {})
    for tag in tags:
        concept = us_gaap.get(tag)
        if not concept:
            continue
        units_data = concept.get("units", {}).get(unit, [])
        if units_data:
            return units_data
    return []


def _pick_period_value(entries: list[dict], period_end: str, form_type: str) -> Optional[dict]:
    """Pick the best matching entry for a given period-end date and form."""
    # Filter by period end date and form type
    matches = [
        e for e in entries
        if e.get("end") == period_end and form_type in e.get("form", "")
    ]
    if not matches:
        return None
    # Prefer most recently filed
    matches.sort(key=lambda x: x.get("filed", ""), reverse=True)
    return matches[0]


def _fmt(value, unit="USD") -> Optional[str]:
    """Serialize a numeric value + unit to JSON string for DB storage."""
    if value is None:
        return None
    return json.dumps({"value": value, "unit": unit})


def parse_financials(facts_data: dict, cik: str, symbol_id: int, ticker: str) -> list[dict]:
    """
    Parse EDGAR company_facts JSON into a list of FinancialStatement dicts.
    Returns up to 20 most recent periods (mix of annual + quarterly).
    """
    from app.models.edgar import FinancialStatement

    # Get list of 10-K and 10-Q filing periods from the filing history in facts
    # We use revenue time series to discover available periods
    all_tags = {**_INCOME_TAGS, **_BALANCE_TAGS, **_CASHFLOW_TAGS}

    # Discover all available periods from revenue (most reliably present)
    period_index: dict[str, dict] = {}  # "2024-Q3" → {period_end, fiscal_year, fiscal_quarter, form}

    revenue_entries = _extract_concept(facts_data, _INCOME_TAGS["revenue"])
    for entry in revenue_entries:
        form = entry.get("form", "")
        if form not in ("10-K", "10-Q", "10-K/A", "10-Q/A"):
            continue
        end = entry.get("end", "")
        if not end:
            continue
        fy = int(end[:4])
        is_annual = "10-K" in form

        if is_annual:
            key = f"{fy}-FY"
            period_index.setdefault(key, {"period": key, "fiscal_year": fy, "fiscal_quarter": None, "form": "10-K", "period_end_date": end, "filed_date": entry.get("filed", "")})
        else:
            # Derive quarter from end date
            month = int(end[5:7])
            fq = (month // 3) if month % 3 == 0 else (month // 3 + 1)
            key = f"{fy}-Q{fq}"
            period_index.setdefault(key, {"period": key, "fiscal_year": fy, "fiscal_quarter": fq, "form": "10-Q", "period_end_date": end, "filed_date": entry.get("filed", "")})

    # Sort by period descending, take 20 most recent
    periods = sorted(period_index.values(), key=lambda x: x["period_end_date"], reverse=True)[:20]

    results = []
    for p in periods:
        period_end = p["period_end_date"]
        form = p["form"]
        row = {
            "cik": cik,
            "symbol_id": symbol_id,
            "period": p["period"],
            "fiscal_year": p["fiscal_year"],
            "fiscal_quarter": p["fiscal_quarter"],
            "form": form,
            "period_end_date": period_end,
            "filed_date": p["filed_date"],
        }

        # Income statement
        for field, tags in _INCOME_TAGS.items():
            entries = _extract_concept(facts_data, tags, "USD" if field not in ("eps_basic", "eps_diluted") else "USD/shares")
            # Also try USD for eps fallback
            if not entries and field in ("eps_basic", "eps_diluted"):
                entries = _extract_concept(facts_data, tags, "USD")
            match = _pick_period_value(entries, period_end, form)
            unit = "USD/shares" if field in ("eps_basic", "eps_diluted") else "USD"
            if field in ("shares_basic", "shares_diluted"):
                entries = _extract_concept(facts_data, tags, "shares")
                match = _pick_period_value(entries, period_end, form)
                unit = "shares"
            row[field] = _fmt(match["val"] if match else None, unit)

        # Balance sheet
        for field, tags in _BALANCE_TAGS.items():
            entries = _extract_concept(facts_data, tags)
            match = _pick_period_value(entries, period_end, form)
            row[field] = _fmt(match["val"] if match else None)

        # Cash flow
        for field, tags in _CASHFLOW_TAGS.items():
            entries = _extract_concept(facts_data, tags)
            match = _pick_period_value(entries, period_end, form)
            row[field] = _fmt(match["val"] if match else None)

        # Compute free cash flow
        try:
            ocf = json.loads(row.get("operating_cash_flow") or "null")
            capex = json.loads(row.get("capital_expenditures") or "null")
            if ocf and capex and ocf.get("value") is not None and capex.get("value") is not None:
                row["free_cash_flow"] = _fmt(ocf["value"] - capex["value"])
            else:
                row["free_cash_flow"] = None
        except Exception:
            row["free_cash_flow"] = None

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

async def generate_filing_insights(ticker: str, financials: list[dict], filings: list[dict], company_info: dict) -> str:
    """Generate AI insights on a company's filings using Claude."""
    import os

    # Build context from recent financials
    recent = financials[:8] if financials else []
    fin_summary = []
    for f in recent:
        def _val(field):
            try:
                v = json.loads(f.get(field) or "null")
                return v["value"] if v else None
            except Exception:
                return None

        rev = _val("revenue")
        ni = _val("net_income")
        ocf = _val("operating_cash_flow")

        line = f"{f.get('period','?')} ({f.get('form','?')})"
        if rev: line += f" Revenue: ${rev/1e9:.2f}B"
        if ni: line += f" Net Income: ${ni/1e9:.2f}B"
        if ocf: line += f" OCF: ${ocf/1e9:.2f}B"
        fin_summary.append(line)

    recent_filings = [f"{f['form_type']} filed {f['filing_date']}" for f in filings[:5]]

    prompt = f"""You are a senior equity analyst. Analyze {ticker} ({company_info.get('company_name', ticker)}) based on SEC EDGAR data.

Company: {company_info.get('company_name', ticker)}
Industry: {company_info.get('sic_description', 'N/A')}
Recent filings: {', '.join(recent_filings)}

Financial trend (most recent first):
{chr(10).join(fin_summary) if fin_summary else 'No financial data available'}

Provide a concise 4-section analysis:
1. **Revenue & Profitability Trend**: Revenue growth, margin trajectory, net income trend
2. **Balance Sheet Health**: Debt levels, cash position, liquidity
3. **Cash Flow Quality**: Operating vs free cash flow, capex intensity
4. **Key Risks & Opportunities**: From recent filings, flag any notable risks or growth catalysts

Keep each section to 2-3 sentences. Be specific with numbers where available. Focus on what matters most to investors."""

    try:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import HumanMessage
        import os

        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            return _fallback_insights(ticker, financials, company_info)

        llm = ChatAnthropic(model="claude-haiku-4-5-20251001", max_tokens=800, api_key=api_key)
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        return response.content
    except Exception as e:
        logger.warning("AI insight generation failed: %s", e)
        return _fallback_insights(ticker, financials, company_info)


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

    # Revenue trend
    revs = [_val(f, "revenue") for f in financials[:4] if _val(f, "revenue")]
    if len(revs) >= 2:
        growth = (revs[0] - revs[-1]) / abs(revs[-1]) * 100 if revs[-1] != 0 else 0
        lines.append(f"**Revenue & Profitability**: Latest revenue ${revs[0]/1e9:.2f}B, {'+' if growth>0 else ''}{growth:.1f}% vs {len(revs)} periods ago.")

    # Net income
    nis = [_val(f, "net_income") for f in financials[:2] if _val(f, "net_income") is not None]
    if nis:
        lines.append(f"Net income: ${nis[0]/1e9:.2f}B (most recent period).")

    # OCF
    ocfs = [_val(f, "operating_cash_flow") for f in financials[:2] if _val(f, "operating_cash_flow")]
    if ocfs:
        fcfs = [_val(f, "free_cash_flow") for f in financials[:2] if _val(f, "free_cash_flow")]
        lines.append(f"\n**Cash Flow**: Operating cash flow ${ocfs[0]/1e9:.2f}B." + (f" Free cash flow ${fcfs[0]/1e9:.2f}B." if fcfs else ""))

    return "\n".join(lines) if len(lines) > 1 else f"Financial data loaded for {ticker}. AI insights require Claude API key."


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
    for row in financial_rows:
        existing = db.query(FinancialStatement).filter(
            FinancialStatement.symbol_id == symbol.id,
            FinancialStatement.period == row["period"],
            FinancialStatement.form == row["form"],
        ).first()
        if existing:
            for k, v in row.items():
                if k not in ("symbol_id", "cik"):
                    setattr(existing, k, v)
        else:
            db.add(FinancialStatement(**row))
            upserted += 1

    db.commit()
    logger.info("Synced EDGAR data for %s: CIK=%s, %d periods, %d new", ticker, cik, len(financial_rows), upserted)
    return {"status": "ok", "cik": cik, "periods": len(financial_rows), "new_records": upserted}
