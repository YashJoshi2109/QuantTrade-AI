"""
Script to sync news and filings for symbols
"""
import sys
import os
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import SessionLocal
from app.services.news_fetcher import NewsFetcher
from app.services.filings_fetcher import FilingsFetcher
from app.config import settings


def sync_news_and_filings():
    """Sync news and filings for default symbols"""
    db = SessionLocal()
    from app.models.symbol import Symbol
    
    symbols = settings.DEFAULT_SYMBOLS.split(",")
    
    news_fetcher = NewsFetcher()
    filings_fetcher = FilingsFetcher()
    
    print(f"Syncing news and filings for {len(symbols)} symbols...")
    
    for symbol in symbols:
        symbol = symbol.strip()
        print(f"\nProcessing {symbol}...")
        
        try:
            # Ensure symbol exists in database
            db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
            if not db_symbol:
                print(f"  Creating symbol {symbol}...")
                db_symbol = Symbol(symbol=symbol.upper(), name=f"{symbol} Inc.")
                db.add(db_symbol)
                db.commit()
                db.refresh(db_symbol)
            
            # Sync news
            news_count = news_fetcher.sync_news_for_symbol(db, symbol, use_mock=True)
            print(f"  ✓ News: {news_count} articles")
            
            # Sync filings
            filings_count = filings_fetcher.sync_filings_for_symbol(db, symbol, use_mock=True)
            print(f"  ✓ Filings: {filings_count} filings")
            
            # Generate embeddings for filing chunks (in background)
            from app.models.filing import Filing
            
            if db_symbol:
                filings = db.query(Filing).filter(Filing.symbol_id == db_symbol.id).all()
                for filing in filings:
                    # Process embeddings (can be done async if Celery is running)
                    try:
                        from app.tasks.embeddings import process_filing_chunks_task
                        process_filing_chunks_task.delay(filing.id)
                        print(f"  ✓ Queued embeddings for filing {filing.id}")
                    except Exception:
                        # Celery not running, skip async processing
                        pass
            
        except Exception as e:
            print(f"  ✗ Error: {e}")
            db.rollback()  # Rollback on error
    
    db.close()
    print("\nDone!")


if __name__ == "__main__":
    sync_news_and_filings()
