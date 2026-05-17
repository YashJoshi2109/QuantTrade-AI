"""SEC EDGAR financial data models."""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class CompanyEDGAR(Base):
    """SEC EDGAR company metadata — CIK, SIC, description, employee count."""
    __tablename__ = "company_edgar"

    id = Column(Integer, primary_key=True, index=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False, unique=True, index=True)
    cik = Column(String(20), nullable=False, unique=True, index=True)
    company_name = Column(String(255))
    sic = Column(String(10))
    sic_description = Column(String(255))
    state_of_incorporation = Column(String(10))
    fiscal_year_end = Column(String(10))      # e.g. "1231" = Dec 31
    ein = Column(String(20))
    category = Column(String(100))
    description = Column(Text)               # from company facts entity description
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    symbol = relationship("Symbol", backref="edgar_info")


class FinancialStatement(Base):
    """Parsed quarterly/annual financials from SEC EDGAR XBRL (company facts)."""
    __tablename__ = "financial_statements"

    id = Column(Integer, primary_key=True, index=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False, index=True)
    cik = Column(String(20), nullable=False, index=True)
    period = Column(String(10), nullable=False)           # e.g. "2024-Q3" or "2023-FY"
    fiscal_year = Column(Integer)
    fiscal_quarter = Column(Integer, nullable=True)       # null = annual
    form = Column(String(20))                             # 10-K or 10-Q
    period_end_date = Column(String(20))                  # YYYY-MM-DD
    filed_date = Column(String(20))

    # Income Statement (all in USD, raw XBRL values)
    revenue = Column(Text)              # JSON: {"value": 123456, "unit": "USD"}
    gross_profit = Column(Text)
    operating_income = Column(Text)
    net_income = Column(Text)
    eps_basic = Column(Text)
    eps_diluted = Column(Text)
    shares_basic = Column(Text)
    shares_diluted = Column(Text)
    ebitda = Column(Text)
    rd_expense = Column(Text)
    sga_expense = Column(Text)

    # Balance Sheet
    total_assets = Column(Text)
    current_assets = Column(Text)
    cash_and_equivalents = Column(Text)
    total_liabilities = Column(Text)
    current_liabilities = Column(Text)
    long_term_debt = Column(Text)
    stockholders_equity = Column(Text)
    retained_earnings = Column(Text)
    goodwill = Column(Text)
    intangible_assets = Column(Text)

    # Cash Flow Statement
    operating_cash_flow = Column(Text)
    investing_cash_flow = Column(Text)
    financing_cash_flow = Column(Text)
    capital_expenditures = Column(Text)
    free_cash_flow = Column(Text)        # computed: OCF - CapEx
    dividends_paid = Column(Text)
    share_repurchases = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    symbol = relationship("Symbol", backref="financial_statements")

    __table_args__ = (
        UniqueConstraint("symbol_id", "period", "form", name="uq_financial_statement"),
        Index("idx_fs_symbol_period", "symbol_id", "period"),
    )
