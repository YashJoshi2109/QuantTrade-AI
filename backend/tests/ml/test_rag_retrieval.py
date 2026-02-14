from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.models import Base, Filing, FilingChunk, Symbol
from app.services.rag_service import RAGService


def _setup_in_memory_db():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    return engine


def test_rag_service_basic_retrieval():
    engine = _setup_in_memory_db()
    SessionLocal = sessionmaker(bind=engine)
    db: Session = SessionLocal()

    # Seed a symbol and a simple filing chunk
    symbol = Symbol(symbol="AAPL", name="Apple Inc.")
    db.add(symbol)
    db.flush()

    filing = Filing(
        symbol_id=symbol.id,
        filing_type="10-K",
        form_type="10-K",
        filing_date="2024-01-01",
    )
    db.add(filing)
    db.flush()

    chunk = FilingChunk(
        filing_id=filing.id,
        chunk_index=0,
        content="Apple is a technology company that designs, manufactures smartphones.",
        section="Business Overview",
    )
    db.add(chunk)
    db.commit()

    rag = RAGService()
    result = rag.query(
        db=db,
        query="What does Apple do?",
        symbol="AAPL",
        symbol_id=symbol.id,
        include_news=False,
        include_filings=True,
        top_k=3,
    )

    # We expect a response string and at least one context doc used.
    assert "response" in result
    assert isinstance(result["response"], str)
    assert result["context_docs"] >= 1

