"""Research page API — SEC EDGAR financials, company overview, filings, AI insights."""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.edgar import CompanyEDGAR, FinancialStatement
from app.models.symbol import Symbol
from app.services.sec_edgar_service import (
    sync_edgar_data, get_cik, parse_filings_list, get_submissions,
    generate_filing_insights,
)

router = APIRouter(prefix="/api/v1/research", tags=["research"])
logger = logging.getLogger(__name__)


def _get_symbol(ticker: str, db: Session) -> Symbol:
    # Symbol model uses .symbol column (not .ticker)
    sym = db.query(Symbol).filter(Symbol.symbol == ticker.upper()).first()
    if not sym:
        raise HTTPException(status_code=404, detail=f"Symbol {ticker} not found")
    return sym


def _parse_val(json_str: Optional[str]) -> Optional[float]:
    """Parse stored JSON value string → float."""
    if not json_str:
        return None
    try:
        return json.loads(json_str).get("value")
    except Exception:
        return None


# ── Company overview ──────────────────────────────────────────────────

@router.get("/{ticker}/company-overview")
async def company_overview(
    ticker: str,
    db: Session = Depends(get_db),
):
    """Company facts from SEC EDGAR — CIK, SIC, incorporation state, fiscal year."""
    sym = _get_symbol(ticker, db)
    edgar = db.query(CompanyEDGAR).filter(CompanyEDGAR.symbol_id == sym.id).first()

    if not edgar:
        # Trigger sync in background
        result = sync_edgar_data(ticker, db)
        if result["status"] == "error":
            raise HTTPException(status_code=404, detail=result["message"])
        edgar = db.query(CompanyEDGAR).filter(CompanyEDGAR.symbol_id == sym.id).first()

    if not edgar:
        raise HTTPException(status_code=404, detail="EDGAR data not available")

    return {
        "ticker": ticker.upper(),
        "cik": edgar.cik,
        "company_name": edgar.company_name,
        "sic": edgar.sic,
        "sic_description": edgar.sic_description,
        "state_of_incorporation": edgar.state_of_incorporation,
        "fiscal_year_end": edgar.fiscal_year_end,
        "category": edgar.category,
        "updated_at": edgar.updated_at.isoformat() if edgar.updated_at else None,
    }


# ── Financial statements ───────────────────────────────────────────────

@router.get("/{ticker}/financials")
async def get_financials(
    ticker: str,
    period_type: str = Query("quarterly", pattern="^(annual|quarterly|all)$"),
    limit: int = Query(12, ge=1, le=40),
    db: Session = Depends(get_db),
):
    """
    Income statement, balance sheet, cash flow.
    period_type: annual | quarterly | all
    """
    sym = _get_symbol(ticker, db)

    q = db.query(FinancialStatement).filter(FinancialStatement.symbol_id == sym.id)
    if period_type == "annual":
        q = q.filter(FinancialStatement.fiscal_quarter == None)
    elif period_type == "quarterly":
        q = q.filter(FinancialStatement.fiscal_quarter != None)

    rows = q.order_by(FinancialStatement.period_end_date.desc()).limit(limit).all()

    if not rows:
        # Auto-sync if no data
        result = sync_edgar_data(ticker, db)
        if result["status"] == "ok":
            q2 = db.query(FinancialStatement).filter(FinancialStatement.symbol_id == sym.id)
            if period_type == "annual":
                q2 = q2.filter(FinancialStatement.fiscal_quarter == None)
            elif period_type == "quarterly":
                q2 = q2.filter(FinancialStatement.fiscal_quarter != None)
            rows = q2.order_by(FinancialStatement.period_end_date.desc()).limit(limit).all()

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
    }


# ── Filings list ───────────────────────────────────────────────────────

@router.get("/{ticker}/filings")
async def get_filings(
    ticker: str,
    form_types: str = Query("10-K,10-Q,8-K", description="Comma-separated form types"),
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Recent SEC filings for a ticker."""
    cik = get_cik(ticker)
    if not cik:
        raise HTTPException(status_code=404, detail=f"CIK not found for {ticker}")

    submissions = get_submissions(cik)
    if not submissions:
        raise HTTPException(status_code=503, detail="SEC EDGAR temporarily unavailable")

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
    db: Session = Depends(get_db),
):
    """AI-generated analysis of company financials and filings."""
    sym = _get_symbol(ticker, db)

    # Get financial data
    rows = db.query(FinancialStatement).filter(
        FinancialStatement.symbol_id == sym.id
    ).order_by(FinancialStatement.period_end_date.desc()).limit(8).all()

    financials = []
    for r in rows:
        financials.append({
            "period": r.period,
            "form": r.form,
            "period_end_date": r.period_end_date,
            "revenue": r.revenue,
            "net_income": r.net_income,
            "operating_cash_flow": r.operating_cash_flow,
            "free_cash_flow": r.free_cash_flow,
            "total_assets": r.total_assets,
            "long_term_debt": r.long_term_debt,
        })

    edgar = db.query(CompanyEDGAR).filter(CompanyEDGAR.symbol_id == sym.id).first()
    company_info = {
        "company_name": edgar.company_name if edgar else ticker,
        "sic_description": edgar.sic_description if edgar else "",
    }

    # Get recent filings
    cik = get_cik(ticker)
    filings = []
    if cik:
        submissions = get_submissions(cik)
        if submissions:
            filings = parse_filings_list(submissions, limit=5)

    insights = await generate_filing_insights(ticker, financials, filings, company_info)
    return {"ticker": ticker.upper(), "insights": insights}


# ── Sync trigger ───────────────────────────────────────────────────────

@router.post("/{ticker}/sync")
async def sync_ticker(
    ticker: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger EDGAR data sync for a ticker (runs in background)."""
    background_tasks.add_task(sync_edgar_data, ticker, db, True)
    return {"status": "sync_started", "ticker": ticker.upper()}
