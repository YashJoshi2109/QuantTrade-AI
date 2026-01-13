"""
SEC filing model
"""
from sqlalchemy import Column, String, DateTime, Text, Integer, ForeignKey, Index, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.db.database import Base


class FilingType(str, enum.Enum):
    """SEC filing types"""
    FORM_10K = "10-K"
    FORM_10Q = "10-Q"
    FORM_8K = "8-K"
    FORM_DEF14A = "DEF 14A"  # Proxy statement
    FORM_S1 = "S-1"
    OTHER = "OTHER"


class Filing(Base):
    __tablename__ = "filings"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False, index=True)
    filing_type = Column(String(20))
    form_type = Column(String(20))  # 10-K, 10-Q, etc.
    filing_date = Column(DateTime(timezone=True), nullable=False, index=True)
    period_end_date = Column(DateTime(timezone=True))
    accession_number = Column(String(50), unique=True)
    url = Column(String(1000))
    content = Column(Text)  # Full text content
    summary = Column(Text)  # AI-generated summary
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    symbol = relationship("Symbol", backref="filings")
    
    __table_args__ = (
        Index('idx_symbol_filing_date', 'symbol_id', 'filing_date'),
    )


class FilingChunk(Base):
    """Chunked filing content for RAG"""
    __tablename__ = "filing_chunks"
    
    id = Column(Integer, primary_key=True, index=True)
    filing_id = Column(Integer, ForeignKey("filings.id"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    section = Column(String(100))  # e.g., "Risk Factors", "Management Discussion"
    embedding = Column(Text)  # JSON array of embedding vector (will use pgvector Vector type later)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    filing = relationship("Filing", backref="chunks")
    
    __table_args__ = (
        Index('idx_filing_chunk', 'filing_id', 'chunk_index'),
    )
