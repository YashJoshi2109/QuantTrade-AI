#!/usr/bin/env python3
"""
Database migration script for Global Monitor tables
Run this to create all required tables
"""
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine, Base
from app.models.global_monitor import (
    GlobalEvent, TickerImpact,
    EventAnomaly, CountryInstability, GeographicCluster,
    DataIngestionLog, MarketImpactHistory
)


def create_tables():
    """Create all Global Monitor tables"""
    print("Creating Global Monitor tables...")
    print("=" * 60)
    
    try:
        # Import all models to ensure they're registered
        import app.models.user
        import app.models.symbol
        import app.models.watchlist
        import app.models.portfolio
        # import app.models.backtest  # Skipped if not present
        # import app.models.market_data # Skipped if not present
        
        # Create all tables
        Base.metadata.create_all(bind=engine)
        
        print("✅ Successfully created tables:")
        print("   - global_events")
        print("   - ticker_impacts")
        print("   - event_anomalies")
        print("   - country_instability")
        print("   - geographic_clusters")
        print("   - data_ingestion_logs")
        print("   - market_impact_history")
        print()
        print("=" * 60)
        print("✅ Migration complete!")
        print()
        print("Next steps:")
        print("1. Configure API keys in backend/.env")
        print("2. Run: python scripts/ingest_global_monitor.py")
        print("3. Start Celery workers: celery -A app.tasks worker -l info")
        print("4. Start Celery beat: celery -A app.tasks beat -l info")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    create_tables()
