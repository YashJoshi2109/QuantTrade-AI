
import sys
import os
from sqlalchemy import create_engine, text

# Add current directory to path
sys.path.append(os.getcwd())

# Need to set ENV vars if they are not in .env or if we are not running via tasks
# But assuming .env is loaded or available
from app.config import settings

# Override database URL if needed (but settings.DATABASE_URL should work)
print(f"Connecting to DB: {settings.DATABASE_URL.split('@')[-1]}") # hide password

try:
    engine = create_engine(str(settings.DATABASE_URL))
    with engine.connect() as conn:
        # Check if type 'datasource' exists
        try:
            result = conn.execute(text("SELECT unnest(enum_range(NULL::datasource))")).fetchall()
            print("Enum values in DB:", [r[0] for r in result])
        except Exception as e:
            print(f"Could not fetch enum values: {e}")
            # Try to see if it's a text check constraint instead
            print("Checking check constraints on global_events.source")
            result = conn.execute(text("SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'global_events'::regclass AND contype = 'c'")).fetchall()
            for r in result:
                print(r)

except Exception as e:
    print(f"Error connecting: {e}")
