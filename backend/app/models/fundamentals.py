"""
Fundamentals model for storing detailed stock fundamental data
"""
from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class Fundamentals(Base):
    """Store comprehensive fundamental data from Finviz and other sources"""
    __tablename__ = "fundamentals"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False, unique=True)
    
    # Company Info
    company_name = Column(String(255))
    sector = Column(String(100))
    industry = Column(String(100))
    country = Column(String(100))
    
    # Price Metrics
    price = Column(Float)
    change = Column(String(20))
    volume = Column(Integer)
    avg_volume = Column(Integer)
    
    # Valuation Ratios
    market_cap = Column(Float)
    pe_ratio = Column(Float)
    forward_pe = Column(Float)
    peg_ratio = Column(Float)
    price_to_sales = Column(Float)
    price_to_book = Column(Float)
    enterprise_value = Column(Float)
    ev_to_sales = Column(Float)
    ev_to_ebitda = Column(Float)
    
    # Dividends
    dividend_yield = Column(Float)
    dividend_per_share = Column(Float)
    payout_ratio = Column(Float)
    
    # Profitability Margins
    profit_margin = Column(Float)
    operating_margin = Column(Float)
    gross_margin = Column(Float)
    
    # Returns
    roa = Column(Float)  # Return on Assets
    roe = Column(Float)  # Return on Equity
    roi = Column(Float)  # Return on Investment
    roic = Column(Float)  # Return on Invested Capital
    
    # Financial Health
    debt_to_equity = Column(Float)
    current_ratio = Column(Float)
    quick_ratio = Column(Float)
    cash_ratio = Column(Float)
    
    # Performance Metrics
    week_52_high = Column(Float)
    week_52_low = Column(Float)
    rsi = Column(Float)
    beta = Column(Float)
    atr = Column(Float)  # Average True Range
    
    # Earnings
    eps = Column(Float)  # Trailing 12 months
    eps_next_quarter = Column(Float)
    eps_next_year = Column(Float)
    earnings_date = Column(String(100))
    revenue = Column(Float)
    revenue_per_share = Column(Float)
    quarterly_revenue_growth = Column(Float)
    quarterly_earnings_growth = Column(Float)
    
    # Trading Metrics
    shares_outstanding = Column(Float)
    shares_float = Column(Float)
    short_float = Column(Float)
    short_ratio = Column(Float)
    insider_ownership = Column(Float)
    institutional_ownership = Column(Float)
    
    # Analyst Metrics
    target_price = Column(Float)
    recommendation = Column(String(20))
    analyst_rating = Column(Float)
    
    # Additional Data
    employees = Column(Integer)
    description = Column(Text)
    website = Column(String(255))
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    fetched_at = Column(DateTime(timezone=True))
    
    # Relationship
    symbol = relationship("Symbol", backref="fundamentals")
