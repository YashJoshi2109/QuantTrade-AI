"""Free / public-domain datasets (SEC, FINRA, US Treasury, FRED, BLS, Ken French).

Every row carries:

* ``source``        who published the value (agency + dataset), shown as attribution
* ``available_at``  the point-in-time (PIT) timestamp: when the value became
                    public (SEC acceptance time, filing date, FINRA publication
                    date, release/observation date).  Backtests and ML must only
                    read rows with ``available_at <= as_of``.
* ``fetched_at``    when QuantTrade downloaded it

Tables are created by Base.metadata.create_all on startup and by
``scripts/create_public_data_tables.py`` on deploy (idempotent, new tables only).
Rollback: ``python scripts/create_public_data_tables.py --drop`` (nothing else
references these tables).
"""
from sqlalchemy import (Boolean, Column, DateTime, Float, Index, Integer, String, Text, UniqueConstraint)
from sqlalchemy.sql import func

from app.db.database import Base


class PublicDataLoad(Base):
    """One processed unit of a public dataset (a quarterly ZIP, a ticker's
    Form 4 history, a FINRA settlement date ...): makes refresh jobs idempotent."""
    __tablename__ = "public_data_loads"

    id = Column(Integer, primary_key=True)
    dataset = Column(String(40), nullable=False)          # sec_fsds | sec_13f | form4 | finra_si | ...
    key = Column(String(120), nullable=False)             # 2026q3 | NVDA | 2026-11-13 ...
    status = Column(String(16), nullable=False, default="done")   # done | error | running
    rows = Column(Integer, nullable=False, default=0)
    source_last_modified = Column(String(64))
    note = Column(Text)
    loaded_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("dataset", "key", name="uq_public_data_loads_dataset_key"),)


class PitFundamentalFact(Base):
    """SEC Financial Statement Data Sets (num.txt joined with sub.txt), as
    originally filed.  ``available_at`` = EDGAR acceptance datetime (UTC);
    ``filed`` = filing date.  Amendments are separate rows (their own adsh)."""
    __tablename__ = "pit_fundamental_facts"

    id = Column(Integer, primary_key=True)
    cik = Column(String(10), nullable=False)
    ticker = Column(String(16))
    adsh = Column(String(20), nullable=False)             # accession number
    tag = Column(String(160), nullable=False)
    taxonomy = Column(String(16), nullable=False, default="us-gaap")
    ddate = Column(String(10), nullable=False)            # YYYY-MM-DD (SEC rounds to month end)
    qtrs = Column(Integer, nullable=False)                # 0 = instant, 1 = quarter, 4 = year ...
    uom = Column(String(32), nullable=False)
    value = Column(Float)
    form = Column(String(12))
    fy = Column(Integer)
    fp = Column(String(4))
    period = Column(String(10))                           # balance-sheet date of the filing
    filed = Column(String(10), nullable=False)            # YYYY-MM-DD
    available_at = Column(DateTime(timezone=True), nullable=False)
    dataset = Column(String(10))                          # 2026q3
    source = Column(String(120), nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("adsh", "tag", "ddate", "qtrs", "uom", name="uq_pit_fact"),
        Index("ix_pit_fact_cik_tag", "cik", "tag"),
        Index("ix_pit_fact_ticker_avail", "ticker", "available_at"),
    )


class InsiderTransaction(Base):
    """SEC Form 4 (and 4/A) table rows, one per transaction line."""
    __tablename__ = "insider_transactions"

    id = Column(Integer, primary_key=True)
    ticker = Column(String(16), nullable=False)
    issuer_cik = Column(String(10), nullable=False)
    accession = Column(String(20), nullable=False)
    line_no = Column(Integer, nullable=False)
    form = Column(String(6), nullable=False, default="4")
    filed_date = Column(String(10))
    available_at = Column(DateTime(timezone=True), nullable=False)     # EDGAR acceptance datetime
    owner_cik = Column(String(10))
    owner_name = Column(String(200))
    owner_title = Column(String(200))
    is_director = Column(Boolean, default=False)
    is_officer = Column(Boolean, default=False)
    is_ten_pct = Column(Boolean, default=False)
    tx_date = Column(String(10))
    tx_code = Column(String(4))                      # P purchase, S sale, A award, M exercise, F tax, G gift ...
    security_title = Column(String(200))
    is_derivative = Column(Boolean, default=False)
    shares = Column(Float)
    price = Column(Float)
    acquired_disposed = Column(String(1))            # A | D
    shares_after = Column(Float)
    direct_indirect = Column(String(1))              # D | I
    plan_10b5_1 = Column(Boolean)
    url = Column(String(300))
    source = Column(String(120), nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("accession", "line_no", name="uq_insider_tx_line"),
        Index("ix_insider_tx_ticker_date", "ticker", "tx_date"),
    )


class InstitutionalHolding(Base):
    """SEC Form 13F data sets: one filer's position in one issuer for one
    quarter (lines summed per filer/CUSIP).  Only the largest holders per
    issuer are stored; totals are in InstitutionalOwnershipSummary."""
    __tablename__ = "inst_holdings"

    id = Column(Integer, primary_key=True)
    ticker = Column(String(16), nullable=False)
    cusip = Column(String(9), nullable=False)
    period = Column(String(10), nullable=False)       # quarter end YYYY-MM-DD
    filer_cik = Column(String(10), nullable=False)
    filer_name = Column(String(200))
    shares = Column(Float)
    value_usd = Column(Float)
    accession = Column(String(20))
    filed_date = Column(String(10))
    available_at = Column(DateTime(timezone=True), nullable=False)    # 13F filing date
    source = Column(String(120), nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("ticker", "period", "filer_cik", name="uq_inst_holding"),
        Index("ix_inst_holding_ticker_period", "ticker", "period"),
    )


class InstitutionalOwnershipSummary(Base):
    __tablename__ = "inst_ownership_summary"

    id = Column(Integer, primary_key=True)
    ticker = Column(String(16), nullable=False)
    cusip = Column(String(9), nullable=False)
    cusip_method = Column(String(40))                 # override | issuer_name_match
    period = Column(String(10), nullable=False)
    holders = Column(Integer)
    total_shares = Column(Float)
    total_value_usd = Column(Float)
    dataset = Column(String(40))                      # 01jun2026-31aug2026
    available_at = Column(DateTime(timezone=True), nullable=False)    # last filing date in the data set
    source = Column(String(120), nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("ticker", "period", name="uq_inst_summary"),)


class ShortInterest(Base):
    """FINRA consolidated (exchange + OTC) equity short interest, bi-monthly."""
    __tablename__ = "short_interest"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(16), nullable=False)
    settlement_date = Column(String(10), nullable=False)
    current_short = Column(Float)
    previous_short = Column(Float)
    change_pct = Column(Float)
    avg_daily_volume = Column(Float)
    days_to_cover = Column(Float)
    market_class = Column(String(8))
    available_at = Column(DateTime(timezone=True), nullable=False)    # settlement + 7 business days (FINRA schedule)
    source = Column(String(120), nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("symbol", "settlement_date", name="uq_short_interest"),)


class ShortSaleVolume(Base):
    """FINRA Reg SHO daily short-sale volume (consolidated NMS file).  This is
    short *volume* reported to FINRA facilities, not short interest."""
    __tablename__ = "short_sale_volume"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(16), nullable=False)
    trade_date = Column(String(10), nullable=False)
    short_volume = Column(Float)
    short_exempt_volume = Column(Float)
    total_volume = Column(Float)
    markets = Column(String(32))
    available_at = Column(DateTime(timezone=True), nullable=False)    # file publication (trade date evening ET)
    source = Column(String(120), nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("symbol", "trade_date", name="uq_short_sale_volume"),)


class MacroObservation(Base):
    """Treasury par yield curve points, FRED series, BLS series and Fama-French
    factors, one value per series and date."""
    __tablename__ = "macro_observations"

    id = Column(Integer, primary_key=True)
    series_id = Column(String(40), nullable=False)    # UST_10Y | DGS10 | BLS_CUUR0000SA0 | FF5_MKT_RF ...
    obs_date = Column(String(10), nullable=False)
    value = Column(Float)
    available_at = Column(DateTime(timezone=True), nullable=False)
    source = Column(String(120), nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("series_id", "obs_date", name="uq_macro_obs"),
        Index("ix_macro_obs_series_date", "series_id", "obs_date"),
    )


class FilingLanguageMetric(Base):
    """In-house text metrics of 10-K / 10-Q filings (one row per filing and
    section).  ML feature table: join on ``available_at`` (EDGAR filing date)."""
    __tablename__ = "filing_language_metrics"

    id = Column(Integer, primary_key=True)
    ticker = Column(String(16), nullable=False)
    cik = Column(String(10))
    accession = Column(String(20), nullable=False)
    form = Column(String(10))
    filed_date = Column(String(10))
    report_date = Column(String(10))
    section = Column(String(24), nullable=False)      # full | risk_factors | mdna
    words = Column(Integer)
    sentences = Column(Integer)
    fog = Column(Float)
    flesch = Column(Float)
    negative = Column(Integer)
    positive = Column(Integer)
    uncertainty = Column(Integer)
    litigious = Column(Integer)
    similarity_prev = Column(Float)                   # cosine vs same section of the prior same-form filing
    prev_accession = Column(String(20))
    method_version = Column(String(16), nullable=False)
    available_at = Column(DateTime(timezone=True), nullable=False)
    source = Column(String(160), nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("accession", "section", "method_version", name="uq_filing_lang"),
        Index("ix_filing_lang_ticker_filed", "ticker", "filed_date"),
    )


PUBLIC_DATA_TABLES = [
    PublicDataLoad, PitFundamentalFact, InsiderTransaction, InstitutionalHolding,
    InstitutionalOwnershipSummary, ShortInterest, ShortSaleVolume, MacroObservation, FilingLanguageMetric,
]
