
import sys
import os
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError

sys.path.append(os.getcwd())
from app.config import settings

def fix_enums():
    print(f"Connecting to DB: {settings.DATABASE_URL.split('@')[-1]}")
    engine = create_engine(str(settings.DATABASE_URL), isolation_level="AUTOCOMMIT")
    
    missing_values = ['AISSTREAM', 'EIA', 'AVIATIONSTACK']
    
    with engine.connect() as conn:
        for val in missing_values:
            try:
                print(f"Adding value '{val}' to datasource enum...")
                conn.execute(text(f"ALTER TYPE datasource ADD VALUE '{val}'"))
                print(f"✅ Added {val}")
            except ProgrammingError as e:
                if "duplicate key value" in str(e) or "already exists" in str(e):
                     print(f"⚠️ {val} already exists (skipping)")
                else:
                    # Check if error message indicates it exists
                    # Postgres error: "enum label "AISSTREAM" already exists"
                    if "already exists" in str(e.orig):
                         print(f"⚠️ {val} already exists (skipping)")
                    else:
                        print(f"❌ Failed to add {val}: {e}")
            except Exception as e:
                print(f"❌ Unexpected error adding {val}: {e}")

if __name__ == "__main__":
    fix_enums()
