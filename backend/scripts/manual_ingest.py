import sys
import os
import asyncio
from datetime import datetime

# Add the parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import SessionLocal
from app.tasks.global_monitor_tasks import (
    _sync_opensky_flights_async,
    _sync_gdelt_news_async,
    _sync_acled_conflicts_async,
    _sync_nasa_fires_async,
    _sync_fred_economics_async,
    _sync_eia_energy_async,
    _sync_aviation_stack_async,
    _sync_ais_vessels_async
)

def run_ingestion():
    db = SessionLocal()
    print("🚀 Starting manual data ingestion...")
    
    try:
        # Run tasks sequentially
        print("\n1. Fetching ACLED Conflict Data...")
        try:
            asyncio.run(_sync_acled_conflicts_async(db))
        except Exception as e:
            print(f"❌ ACLED failed: {e}")

        print("\n2. Fetching NASA Wildfire Data...")
        try:
             asyncio.run(_sync_nasa_fires_async(db))
        except Exception as e:
            print(f"❌ NASA failed: {e}")

        print("\n3. Fetching FRED Economic Data...")
        try:
            asyncio.run(_sync_fred_economics_async(db))
        except Exception as e:
            print(f"❌ FRED failed: {e}")
            
        print("\n4. Fetching AIS Vessel Data (30s snapshot)...")
        try:
             asyncio.run(_sync_ais_vessels_async(db))
        except Exception as e:
             print(f"❌ AISStream failed: {e}")

        print("\n5. Fetching AviationStack Flight Data...")
        try:
            asyncio.run(_sync_aviation_stack_async(db))
        except Exception as e:
            print(f"❌ AviationStack failed: {e}")
            
        print("\n✅ Ingestion Complete! Check your Dashboard.")
        
    finally:
        db.close()

if __name__ == "__main__":
    run_ingestion()
