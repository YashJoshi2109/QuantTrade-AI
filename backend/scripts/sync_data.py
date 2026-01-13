"""
Script to sync initial market data
"""
import sys
import os
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import SessionLocal
from app.services.data_fetcher import DataFetcher
from app.config import settings


def sync_default_symbols():
    """Sync data for default symbols"""
    db = SessionLocal()
    symbols = settings.DEFAULT_SYMBOLS.split(",")
    
    print(f"Syncing data for {len(symbols)} symbols...")
    
    for symbol in symbols:
        symbol = symbol.strip()
        print(f"Syncing {symbol}...")
        try:
            db_symbol = DataFetcher.sync_symbol_to_db(db, symbol)
            count = DataFetcher.sync_price_data_to_db(db, symbol)
            print(f"  ✓ {symbol}: {count} bars inserted")
        except Exception as e:
            print(f"  ✗ {symbol}: Error - {e}")
    
    db.close()
    print("Done!")


if __name__ == "__main__":
    sync_default_symbols()
