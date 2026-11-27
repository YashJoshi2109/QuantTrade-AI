"""Research page API — SEC EDGAR financials, company overview, filings, AI insights."""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db import database as _database
from app.db.database import get_db
from app.services.sync_rate_limit import sync_rate_limit
from app.services.instrument_identity import identity_check, ticker_identity
from app.services.ticker_validation import classify_asset_type
from app.models.edgar import CompanyEDGAR, FinancialStatement
from app.models.symbol import Symbol
from app.models.user import User
from app.api.auth import get_current_user
from app.services import sec_edgar_service as _sec_mod
from app.services.sec_filer import filer_type_for_cik
from app.services.sec_edgar_service import (
    sync_edgar_data, get_cik, parse_filings_list, get_submissions,
    generate_filing_insights, stored_parser_version, PARSER_VERSION,
)

router = APIRouter(prefix="/api/v1/research", tags=["research"])
logger = logging.getLogger(__name__)


def _get_symbol(ticker: str, db: Session) -> Symbol:
    # Symbol model uses .symbol column (not .ticker)
    sym = db.query(Symbol).filter(Symbol.symbol == ticker.upper()).first()
    if not sym:
        raise HTTPException(status_code=404, detail=f"Symbol {ticker} not found")
    return sym


# ── Single-flight EDGAR sync ──────────────────────────────────────────
# A sync downloads + parses the full XBRL companyfacts JSON (tens of MB for
# JPM/BAC) and holds the GIL while parsing. The research page fires
# overview + quarterly + annual + insights at once, and after a PARSER_VERSION
# bump EVERY request re-synced inline with the request's DB session open, so
# several copies of the same 30-90s sync ran in parallel and pinned pool
# connections. Now: one sync per ticker at a time, in its own session; callers
# with stale rows get them immediately while the re-sync runs in background.
_SYNC_WAIT_S = 25.0
_SYNC_FRESH_S = 600.0
_sync_guard = threading.Lock()
_sync_locks: dict = {}
_sync_ok_at: dict = {}
_sync_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="edgar-sync")


def _sync_lock(ticker: str) -> threading.Lock:
    with _sync_guard:
        return _sync_locks.setdefault(ticker, threading.Lock())


def _sync_once(ticker: str, wait: float = _SYNC_WAIT_S) -> dict:
    """Run sync_edgar_data for ticker unless one is running / just finished.

    Returns the sync result, {"status": "ok"} when a recent sync already
    succeeded, or {"status": "pending"} if another sync is still running
    after ``wait`` seconds.
    """
    ticker = ticker.upper()
    lock = _sync_lock(ticker)
    acquired = lock.acquire(timeout=wait) if wait > 0 else lock.acquire(blocking=False)
    if not acquired:
        return {"status": "pending", "message": f"EDGAR sync for {ticker} in progress"}
    try:
        if time.monotonic() - _sync_ok_at.get(ticker, -1e9) < _SYNC_FRESH_S:
            return {"status": "ok", "message": "synced recently"}
        if _database.SessionLocal is None:
            return {"status": "error", "message": "Database not configured"}
        db = _database.SessionLocal()
        try:
            result = sync_edgar_data(ticker, db)
        except Exception as e:
            db.rollback()
            logger.exception("EDGAR sync failed for %s", ticker)
            result = {"status": "error", "message": str(e)}
        finally:
            db.close()
        if result.get("status") == "ok":
            _sync_ok_at[ticker] = time.monotonic()
        return result
    finally:
        lock.release()


def _sync_in_background(ticker: str) -> None:
    ticker = ticker.upper()
    if _sync_lock(ticker).locked():
        return  # already syncing
    _sync_pool.submit(_sync_once, ticker, 0.0)


def _end_read_txn(db: Session) -> None:
    """Return the request's pooled connection before a long sync (reads only)."""
    try:
        db.commit()
    except Exception:
        db.rollback()


def _parse_val(json_str: Optional[str]) -> Optional[float]:
    """Parse stored JSON value string → float."""
    if not json_str:
        return None
    try:
        return json.loads(json_str).get("value")
    except Exception:
        return None


# ── Ticker identity ───────────────────────────────────────────────────

@router.get("/{ticker}/identity")
def ticker_identity_endpoint(ticker: str, db: Session = Depends(get_db)):
    """Is this ticker still the company we list? DB-only (no SEC call), cheap.

    Drives the Research page's stale-identity warning on desktop and mobile:
    ``changed`` (known delisting/merger/rename, with successor), ``mismatch``
    (our name disagrees with the SEC filer cached for the ticker) or ``ok``.
    """
    upper = ticker.upper().strip()
    sym = db.query(Symbol).filter(Symbol.symbol == upper).first()
    filer_name = None
    if sym is not None:
        row = db.query(CompanyEDGAR.company_name).filter(CompanyEDGAR.symbol_id == sym.id).first()
        filer_name = row[0] if row else None
    out = ticker_identity(upper, sym.name if sym else None, filer_name)
    succ = out.get("successor_symbol")
    out["successor_listed"] = bool(succ) and db.query(Symbol.id).filter(Symbol.symbol == succ).first() is not None
    out["known_symbol"] = sym is not None
    # Lifecycle (retired / reused tickers): drives the "stopped trading" banner
    # and hides price panels for inactive symbols on desktop and mobile.
    from app.services.ticker_lifecycle import lifecycle_payload

    life = lifecycle_payload(upper, sym)
    out.update(life)
    if life["lifecycle_status"] != "active":
        out["status"] = "changed"
        out["note"] = out.get("note") or life["status_note"]
        out["former_name"] = out.get("former_name") or life["former_name"]
        if not out.get("successor_symbol") and life["successor_symbol"]:
            out["successor_symbol"] = life["successor_symbol"]
            out["successor_listed"] = db.query(Symbol.id).filter(
                Symbol.symbol == life["successor_symbol"]).first() is not None
    return out


def _sec_error(status: int, code: str, message: str, retry_after: Optional[int] = None) -> HTTPException:
    """Typed error so the UI can tell "no SEC filer" from "EDGAR is down".

    The panel used to treat every 404 as "not applicable (ETF / foreign)",
    which mislabelled US operating companies whenever the first sync failed
    or the ticker had no Symbol row yet (AEIS, INSM, TENB).
    """
    headers = {"Retry-After": str(retry_after)} if retry_after else None
    return HTTPException(status_code=status, detail={"code": code, "message": message}, headers=headers)


def _no_company_payload(upper: str, asset_type: str, name: Optional[str],
                        filer_type: Optional[str], cik: Optional[str] = None) -> dict:
    return {
        "ticker": upper,
        "asset_type": asset_type,
        "filer_type": filer_type,
        "edgar_status": "not_applicable",
        "company_name": name or upper,
        "cik": cik,
        "sic": None,
        "sic_description": None,
        "state_of_incorporation": None,
        "fiscal_year_end": None,
        "category": None,
        "identity_status": "ok",
        "updated_at": None,
    }


def _resolve_cik(upper: str) -> str:
    cik = get_cik(upper)
    if cik:
        return cik
    if not _sec_mod._CIK_CACHE:  # SEC ticker map never loaded: SEC unreachable, not "no filer"
        raise _sec_error(503, "sec_unavailable", "SEC EDGAR is temporarily unavailable", retry_after=30)
    raise _sec_error(404, "no_sec_filer", f"{upper} is not in SEC EDGAR's ticker registry")


def _edgar_row(db: Session, symbol_id: int, ticker: str):
    """The CompanyEDGAR row for a symbol, or its share-class sibling's.

    company_edgar.cik is unique, so GOOG and GOOGL (one filer) share one row,
    owned by whichever class synced first.
    """
    row = db.query(CompanyEDGAR).filter(CompanyEDGAR.symbol_id == symbol_id).first()
    if row is not None:
        return row
    cik = get_cik(ticker)
    return db.query(CompanyEDGAR).filter(CompanyEDGAR.cik == cik).first() if cik else None


def _filer_type(db: Session, symbol_id: Optional[int], cik: Optional[str]) -> str:
    """domestic | foreign | fund | unknown. Parsed 10-K/10-Q rows answer it with no SEC call."""
    if symbol_id is not None:
        try:
            has_us_gaap = db.query(FinancialStatement.id).filter(
                FinancialStatement.symbol_id == symbol_id,
                FinancialStatement.form.in_(("10-K", "10-Q", "10-K/A", "10-Q/A")),
            ).first() is not None
        except Exception:
            db.rollback()
            has_us_gaap = False
        if has_us_gaap:
            return "domestic"
    return filer_type_for_cik(cik, get_submissions)


def _register_sec_filer(upper: str, cik: str, db: Session) -> Optional[Symbol]:
    """Create the Symbol row for a ticker SEC's own registry vouches for.

    US small/mid caps outside the seeded universe (INSM, TENB) had no Symbol
    row, so the overview 404'd and the UI called them "ETFs / foreign issuers".
    Only tickers present in SEC's company_tickers map reach here, so user input
    can never create junk rows. Funds are not registered (returns None).
    """
    subs = get_submissions(cik)
    kind = filer_type_for_cik(cik, lambda _c: subs)
    if kind == "fund":
        return None
    name = (subs or {}).get("name") or None
    sym = Symbol(symbol=upper, name=name, asset_type="Equity",
                 country="US" if kind == "domestic" else None)
    db.add(sym)
    try:
        db.commit()
    except Exception:  # a concurrent first view inserted it (unique symbol)
        db.rollback()
        sym = db.query(Symbol).filter(Symbol.symbol == upper).first()
        if sym is None:
            raise
    return sym


# ── Company overview ──────────────────────────────────────────────────

@router.get("/{ticker}/company-overview")
def company_overview(  # sync: blocking SEC HTTP + DB run in FastAPI's threadpool
    
    ticker: str,
    db: Session = Depends(get_db),
):
    """Company facts from SEC EDGAR — CIK, SIC, incorporation state, fiscal year.

    Always carries ``asset_type`` so the UI can hide company-only panels for
    indices / ETFs (which have no SEC company facts) instead of erroring, and
    ``filer_type`` (domestic | foreign | fund | unknown) so foreign private
    issuers get a 20-F / 6-K view instead of an empty 10-K / 10-Q one.

    Errors carry ``detail.code``: ``no_sec_filer`` (404, nothing in EDGAR),
    ``sync_pending`` / ``sec_unavailable`` (503, retry). Only ``no_sec_filer``
    is a final verdict; a failed SEC download is never reported as one.
    """
    upper = ticker.upper().strip()
    sym = db.query(Symbol).filter(Symbol.symbol == upper).first()
    asset_type = classify_asset_type(upper, sym.asset_type if sym else None)
    if asset_type != "equity":
        return _no_company_payload(
            upper, asset_type, sym.name if sym else None,
            "fund" if asset_type in ("etf", "fund") else None,
        )

    cik: Optional[str] = None
    if sym is None:
        cik = _resolve_cik(upper)
        sym = _register_sec_filer(upper, cik, db)
        if sym is None:
            return _no_company_payload(upper, "fund", None, "fund", cik)

    # Research views drive which tickers the copilot SEC index refreshes.
    from app.services.copilot.viewed import record_view
    record_view(upper)

    edgar = _edgar_row(db, sym.id, upper)

    if not edgar:
        sym_id, sym_name = sym.id, sym.name
        cik = cik or _resolve_cik(upper)
        if filer_type_for_cik(cik, get_submissions) == "fund":
            return _no_company_payload(upper, "fund", sym_name, "fund", cik)
        _end_read_txn(db)
        result = _sync_once(upper)
        if result["status"] == "pending":
            raise _sec_error(503, "sync_pending", result["message"], retry_after=10)
        if result["status"] == "error":
            raise _sec_error(503, "sec_unavailable", result.get("message") or "EDGAR sync failed", retry_after=30)
        edgar = _edgar_row(db, sym_id, upper)
        if not edgar:
            raise _sec_error(503, "sec_unavailable", "EDGAR data not available yet", retry_after=30)

    return {
        "ticker": upper,
        "asset_type": asset_type,
        "filer_type": _filer_type(db, sym.id, edgar.cik),
        "edgar_status": "ok",
        "cik": edgar.cik,
        "company_name": edgar.company_name,
        "sic": edgar.sic,
        "sic_description": edgar.sic_description,
        "state_of_incorporation": edgar.state_of_incorporation,
        "fiscal_year_end": edgar.fiscal_year_end,
        "category": edgar.category,
        # SEC's ticker map is authoritative for who holds the ticker *now*; flag
        # when our listing disagrees (reassigned ticker, e.g. PARA after Skydance).
        **identity_check(upper, sym.name, edgar.company_name),
        "updated_at": edgar.updated_at.isoformat() if edgar.updated_at else None,
    }


# ── Financial statements ───────────────────────────────────────────────

@router.get("/{ticker}/financials")
def get_financials(  # sync: blocking SEC HTTP + DB run in FastAPI's threadpool
    
    ticker: str,
    period_type: str = Query("quarterly", pattern="^(annual|quarterly|all)$"),
    limit: int = Query(12, ge=1, le=40),
    db: Session = Depends(get_db),
):
    """
    Income statement, balance sheet, cash flow.
    period_type: annual | quarterly | all
    """
    sym_id = _get_symbol(ticker, db).id

    def _query_rows():
        q = db.query(FinancialStatement).filter(FinancialStatement.symbol_id == sym_id)
        if period_type == "annual":
            q = q.filter(FinancialStatement.fiscal_quarter == None)
        elif period_type == "quarterly":
            q = q.filter(FinancialStatement.fiscal_quarter != None)
        return q.order_by(FinancialStatement.period_end_date.desc()).limit(limit).all()

    rows = _query_rows()
    stale = False
    syncing = False

    if rows and stored_parser_version(rows[0]) < PARSER_VERSION:
        # Rows from an older parser (YTD sums / calendar labels): serve them now,
        # flagged stale, and re-sync once in the background.
        stale = True
        syncing = True
        _sync_in_background(ticker)
    elif not rows:
        # First view of this ticker: sync inline (single-flight, bounded wait).
        _end_read_txn(db)
        result = _sync_once(ticker)
        if result["status"] == "ok":
            rows = _query_rows()
        syncing = result["status"] == "pending"

    def _row_to_dict(r):
        return {
            "period": r.period,
            "fiscal_year": r.fiscal_year,
            "fiscal_quarter": r.fiscal_quarter,
            "form": r.form,
            "period_end_date": r.period_end_date,
            "filed_date": r.filed_date,
            "income_statement": {
                "revenue": _parse_val(r.revenue),
                "gross_profit": _parse_val(r.gross_profit),
                "operating_income": _parse_val(r.operating_income),
                "net_income": _parse_val(r.net_income),
                "ebitda": _parse_val(r.ebitda),
                "eps_basic": _parse_val(r.eps_basic),
                "eps_diluted": _parse_val(r.eps_diluted),
                "shares_diluted": _parse_val(r.shares_diluted),
                "rd_expense": _parse_val(r.rd_expense),
                "sga_expense": _parse_val(r.sga_expense),
            },
            "balance_sheet": {
                "total_assets": _parse_val(r.total_assets),
                "current_assets": _parse_val(r.current_assets),
                "cash_and_equivalents": _parse_val(r.cash_and_equivalents),
                "total_liabilities": _parse_val(r.total_liabilities),
                "current_liabilities": _parse_val(r.current_liabilities),
                "long_term_debt": _parse_val(r.long_term_debt),
                "stockholders_equity": _parse_val(r.stockholders_equity),
                "retained_earnings": _parse_val(r.retained_earnings),
                "goodwill": _parse_val(r.goodwill),
            },
            "cash_flow": {
                "operating_cash_flow": _parse_val(r.operating_cash_flow),
                "investing_cash_flow": _parse_val(r.investing_cash_flow),
                "financing_cash_flow": _parse_val(r.financing_cash_flow),
                "capital_expenditures": _parse_val(r.capital_expenditures),
                "free_cash_flow": _parse_val(r.free_cash_flow),
                "dividends_paid": _parse_val(r.dividends_paid),
                "share_repurchases": _parse_val(r.share_repurchases),
            },
        }

    return {
        "ticker": ticker.upper(),
        "period_type": period_type,
        "count": len(rows),
        "periods": [_row_to_dict(r) for r in rows],
        "stale": stale,
        "syncing": syncing,
    }


# ── Filings list ───────────────────────────────────────────────────────

@router.get("/{ticker}/filings")
def get_filings(  # sync: blocking SEC HTTP + DB run in FastAPI's threadpool
    
    ticker: str,
    form_types: str = Query("10-K,10-Q,8-K", description="Comma-separated form types"),
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Recent SEC filings for a ticker."""
    cik = _resolve_cik(ticker.upper().strip())

    submissions = get_submissions(cik)
    if not submissions:
        raise _sec_error(503, "sec_unavailable", "SEC EDGAR temporarily unavailable", retry_after=30)

    forms = [f.strip() for f in form_types.split(",")]
    filings = parse_filings_list(submissions, form_types=forms, limit=limit)

    return {
        "ticker": ticker.upper(),
        "cik": cik,
        "count": len(filings),
        "filings": filings,
    }


# ── AI insights ────────────────────────────────────────────────────────

@router.get("/{ticker}/ai-insights")
async def get_ai_insights(
    ticker: str,
    request: Request,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user),
):
    """AI-generated analysis of company financials and filings.

    Cached results are served to anyone.  A cache miss calls the model only for
    an authenticated, verified user with AI quota (ai_guard); anonymous callers
    get the rule-based summary instead.
    """
    sym = await asyncio.to_thread(_get_symbol, ticker, db)

    def _load_rows():
        return db.query(FinancialStatement).filter(
            FinancialStatement.symbol_id == sym.id
        ).order_by(FinancialStatement.period_end_date.desc()).limit(12).all()

    rows = await asyncio.to_thread(_load_rows)
    # Never feed the model numbers from the old (YTD-mixing) parser.
    if not rows or stored_parser_version(rows[0]) < PARSER_VERSION:
        synced = await asyncio.to_thread(_sync_once, ticker)
        if synced.get("status") == "ok":
            rows = await asyncio.to_thread(_load_rows)

    fields = (
        "revenue", "gross_profit", "operating_income", "net_income", "eps_diluted",
        "operating_cash_flow", "capital_expenditures", "free_cash_flow",
        "cash_and_equivalents", "total_assets", "total_liabilities", "current_assets",
        "current_liabilities", "long_term_debt", "stockholders_equity",
    )
    financials = [
        {"period": r.period, "form": r.form, "period_end_date": r.period_end_date,
         **{f: getattr(r, f) for f in fields}}
        for r in rows
    ]

    edgar = await asyncio.to_thread(
        lambda: _edgar_row(db, sym.id, ticker.upper())
    )
    company_info = {
        "company_name": edgar.company_name if edgar else ticker,
        "sic_description": edgar.sic_description if edgar else "",
    }

    # Get recent filings
    cik = await asyncio.to_thread(get_cik, ticker)
    filings = []
    if cik:
        submissions = await asyncio.to_thread(get_submissions, cik)
        if submissions:
            filings = parse_filings_list(submissions, limit=5)

    from app.api.ai_quota import build_context
    from app.services import ai_guard

    admitted = {"ai": False}

    def _before_llm() -> bool:
        if user is None:
            return False
        ctx = build_context(request, user, db, "sec_insights")
        ai_guard.admit_request(ctx)  # 429 / 503 propagate to the caller
        ai_guard.set_context(ctx)
        admitted["ai"] = True
        return True

    insights = await generate_filing_insights(ticker, financials, filings, company_info, before_llm=_before_llm)
    return {"ticker": ticker.upper(), "insights": insights,
            "requires_login": user is None and not admitted["ai"]}


# ── Sync trigger ───────────────────────────────────────────────────────

def _sync_edgar_in_own_session(ticker: str, force_refresh: bool = True) -> None:
    """Background job: open a dedicated DB session.

    The request-scoped session from get_db() is closed as soon as the response
    is sent, so it must never be handed to a BackgroundTasks job.
    """
    if _database.SessionLocal is None:
        logger.warning("EDGAR background sync skipped for %s: database not configured", ticker)
        return
    db = _database.SessionLocal()
    try:
        sync_edgar_data(ticker, db, force_refresh)
    except Exception:
        logger.exception("EDGAR background sync failed for %s", ticker)
        db.rollback()
    finally:
        db.close()


@router.post("/{ticker}/sync", dependencies=[Depends(sync_rate_limit)])
def sync_ticker(
    ticker: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger EDGAR data sync for a ticker (runs in background)."""
    _get_symbol(ticker, db)  # 404 for unknown tickers instead of queueing work
    background_tasks.add_task(_sync_edgar_in_own_session, ticker.upper(), True)
    return {"status": "sync_started", "ticker": ticker.upper()}
