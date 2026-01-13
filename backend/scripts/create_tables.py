"""
Create database tables
Run this once before syncing data
"""
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine, Base
from app.models import Symbol, PriceBar, Watchlist, NewsArticle, Filing, FilingChunk

if __name__ == "__main__":
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("✅ Tables created successfully!")
    print("\nTables created:")
    print("  - symbols")
    print("  - price_bars")
    print("  - watchlists")
    print("  - news_articles")
    print("  - filings")
    print("  - filing_chunks")
