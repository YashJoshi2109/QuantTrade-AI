"""A production-sized ticker context pack (no network, no DB).

The golden fixture data is deliberately small; prod packs carry 8 fiscal
quarters + 3 fiscal years of statements, up to 8 news items with summaries
and AI notes, and (for filing questions) 4 retrieved filing passages.  The
prompt-budget test and scripts measure token cost against this shape.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List

from app.services.copilot.models import (FilingChunkFact, Identity, QuoteFact, TechnicalsFact,
                                         TickerContextPack)
from app.services.copilot.sources import (forecast_fact, fundamentals_fact, news_fact,
                                          statement_periods)

_LOREM = ("Net sales increased primarily due to higher iPhone and Services revenue, partially offset by "
          "lower Mac sales in Greater China. Gross margin percentage expanded on a favourable mix shift "
          "toward Services and cost savings, partially offset by foreign currency headwinds. The Company "
          "continues to face intense competition, supply-chain concentration in Asia, and regulatory "
          "scrutiny of App Store practices in the U.S. and the European Union. ")


def _statement_rows(ticker: str) -> List[dict]:
    rows = []
    base = 90e9
    for fy in (2023, 2024, 2025, 2026):
        for fq in (1, 2, 3):
            if fy == 2023:
                continue
            k = (fy - 2024) * 4 + fq
            rev = base * (1 + 0.02 * k) + fq * 1.3e9
            rows.append({
                "fiscal_year": fy, "fiscal_quarter": fq, "form": "10-Q",
                "period_end_date": f"{fy - (1 if fq == 1 else 0)}-{['12', '03', '06'][fq - 1]}-28",
                "filed_date": f"{fy}-{['02', '05', '08'][fq - 1]}-01",
                "revenue": rev, "gross_profit": rev * 0.462, "operating_income": rev * 0.305,
                "net_income": rev * 0.255, "eps_diluted": 1.41 + k * 0.03,
                "operating_cash_flow": rev * 0.31, "capital_expenditures": -2.9e9,
                "total_assets": 359e9 + k * 1e9, "total_liabilities": 285e9 + k * 1e9,
                "long_term_debt": 92e9 - k * 1e9, "cash_and_equivalents": 29.9e9 + k * 0.3e9,
                "stockholders_equity": 74.1e9 + k * 0.2e9, "shares_diluted": 15.12e9 - k * 0.05e9,
            })
    for fy in (2023, 2024, 2025):
        rev = 4 * base * (1 + 0.05 * (fy - 2023))
        rows.append({
            "fiscal_year": fy, "fiscal_quarter": None, "form": "10-K", "period": f"{fy}-FY",
            "period_end_date": f"{fy}-09-27", "filed_date": f"{fy}-10-31",
            "revenue": rev, "gross_profit": rev * 0.46, "operating_income": rev * 0.30,
            "net_income": rev * 0.25, "eps_diluted": 6.1 + (fy - 2023) * 0.5,
            "operating_cash_flow": rev * 0.3, "capital_expenditures": -11e9,
            "total_assets": 352e9, "total_liabilities": 290e9, "long_term_debt": 95e9,
            "cash_and_equivalents": 29.9e9, "stockholders_equity": 62e9, "shares_diluted": 15.4e9,
        })
    return rows


def prod_like_pack(ticker: str = "AAPL", *, with_filings: bool = False) -> TickerContextPack:
    now = datetime(2026, 11, 26, 15, 10, tzinfo=timezone.utc)
    pack = TickerContextPack(ticker=ticker, name="Apple Inc.", asset_type="equity", identity=Identity(),
                             built_at=now.isoformat())
    pack.quote = QuoteFact(id=f"quote:{ticker}", source="quote cache (public.com)",
                           as_of=(now - timedelta(seconds=40)).isoformat(), ticker=ticker, price=231.42,
                           change=1.87, change_percent=0.8146, volume=41_233_120, previous_close=229.55,
                           day_high=232.1, day_low=229.8, market_session="OPEN")
    pack.fundamentals = fundamentals_fact(ticker, {
        "company_name": "Apple Inc.", "sector": "Technology", "industry": "Consumer Electronics",
        "market_cap": 3.48e12, "pe_ratio": 35.2, "forward_pe": 31.4, "peg_ratio": 2.9,
        "price_to_sales": 8.9, "price_to_book": 52.3, "ev_to_ebitda": 26.1, "eps": 6.57,
        "revenue": 391e9, "profit_margin": 24.3, "operating_margin": 31.2, "gross_margin": 46.2,
        "roe": 160.6, "debt_to_equity": 1.87, "current_ratio": 0.87, "dividend_yield": 0.44,
        "beta": 1.24, "week_52_high": 237.2, "week_52_low": 164.1, "target_price": 245.0,
        "recommendation": 1.9, "earnings_date": "2027-01-29",
        "fetched_at": datetime(2026, 11, 25, 22, 0, tzinfo=timezone.utc)})
    pack.statements = statement_periods(ticker, _statement_rows(ticker))
    pack.forecast = forecast_fact(ticker, {
        "as_of": "2026-11-25", "generated_at": "2026-11-26T06:00:00+00:00", "last_close": 229.55,
        "vol_annualized_pct": 24.8,
        "horizons": [{"h": h, "date": f"2026-12-{h:02d}", "point": 229.55 + h * 0.3,
                      "bands": {"80": [229.55 - h * 2.1, 229.55 + h * 2.4]},
                      "exp_return_pct": 0.13 * h, "prob_up": 0.52} for h in (1, 5, 20)],
        "backtest": {"mase_vs_naive": {"1": 1.01, "5": 0.99, "20": 0.97},
                     "directional_accuracy": {"1": 0.51, "5": 0.53, "20": 0.55}}})
    pack.technicals = TechnicalsFact(
        id=f"ta:{ticker}", source="technical analysis service (OHLCV)", as_of="2026-11-26", ticker=ticker,
        price=231.42, rsi_14=58.3, macd=1.21, macd_signal=0.94, sma_20=226.4, sma_50=221.9,
        sma_200=208.7, atr_14=3.6, high_52w=237.2, low_52w=164.1, trend="bullish",
        momentum="positive", volatility="moderate", signal_strength=0.62)
    pack.news = [news_fact({
        "id": 9000 + i, "title": f"Apple headline number {i} about iPhone demand, services growth and regulation",
        "summary": (_LOREM * 2)[:600], "url": f"https://news.example.com/apple/story-{i}-long-slug-here",
        "source": "Reuters", "source_feed": "rss", "published_at": now - timedelta(hours=6 * i),
        "tickers": [ticker, "MSFT"] if i % 3 == 0 else [ticker], "primary_category": "earnings",
        "sentiment_label": "positive", "sentiment_score": 0.61, "impact": 3,
        "ai": {"note": "Signals resilient premium demand; watch China data and the EU DMA ruling."}})
        for i in range(8)]
    if with_filings:
        pack.filings = [FilingChunkFact(
            id=f"filing:{ticker}-10K-2025-risk-{i}", source="SEC 10-K (EDGAR, accession 0000320193-25-000106)",
            as_of="2025-10-31", ticker=ticker, filing_type="10-K", fiscal_year=2025, section="Risk Factors",
            filed_date="2025-10-31", accession="0000320193-25-000106",
            url="https://www.sec.gov/Archives/edgar/data/320193/000032019325000106/aapl-20250927.htm",
            text=(_LOREM * 5)[:1900], score=0.71 - i * 0.05) for i in range(4)]
    pack.errors = {}
    return pack


def prod_like_history() -> List[dict]:
    """Three earlier exchanges, assistant answers at the 4000-char memory cap."""
    turns = []
    for i in range(3):
        turns.append({"role": "user", "content": f"Earlier question {i} about Apple margins and buybacks?"})
        turns.append({"role": "assistant", "content": ("Apple's gross margin was 46.2% [fs:AAPL:2026-Q3]. "
                                                       + _LOREM * 12)[:4000]})
    return turns
