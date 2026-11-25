"""
Initialize Neon PostgreSQL database for production
This script connects to your Neon database and creates all tables
"""
import os
import sys
from pathlib import Path

# Add parent directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

# DEPRECATED: superseded by scripts/init_rds_database.py (Neon → AWS RDS migration).
# Reads DATABASE_URL from environment; no hardcoded credentials.
neon_db_url = os.environ['DATABASE_URL']

# Convert to psycopg format
if neon_db_url.startswith('postgresql://'):
    neon_db_url = neon_db_url.replace('postgresql://', 'postgresql+psycopg://', 1)

os.environ['DATABASE_URL'] = neon_db_url

from app.db.database import engine, Base
from app.models import symbol, price, news, filing, user, watchlist
from sqlalchemy import text

def init_neon_database():
    """Initialize Neon PostgreSQL database"""
    print("🚀 Initializing Neon PostgreSQL Database...")
    print("=" * 60)
    
    try:
        # Test connection
        print("🔌 Testing connection...")
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version()"))
            version = result.fetchone()[0]
            print(f"✅ Connected to Neon PostgreSQL!")
            print(f"   Version: {version[:60]}...")
        
        # Create all tables
        print("\n📋 Creating tables...")
        Base.metadata.create_all(bind=engine)
        print("✅ All tables created successfully!")
        
        # Verify tables
        print("\n🔍 Verifying tables...")
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
                ORDER BY table_name
            """))
            tables = [row[0] for row in result]
            
            print(f"✅ Found {len(tables)} tables:")
            for table in tables:
                # Get row count
                count_result = conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
                count = count_result.fetchone()[0]
                print(f"   - {table} ({count} rows)")
        
        # Check pgvector
        print("\n🔍 Checking pgvector extension...")
        try:
            with engine.connect() as conn:
                result = conn.execute(text("SELECT * FROM pg_extension WHERE extname = 'vector'"))
                if result.fetchone():
                    print("✅ pgvector extension is installed")
                else:
                    print("⚠️  pgvector extension not found (optional)")
                    print("   To install: CREATE EXTENSION IF NOT EXISTS vector;")
        except Exception as e:
            print(f"⚠️  Could not check pgvector: {e}")
        
        print("\n" + "=" * 60)
        print("✅ Neon database initialization complete!")
        print("\n💡 Your database is ready for production!")
        print("   - Users can now register and login")
        print("   - Data will be stored in Neon PostgreSQL")
        print("   - All tables are created and ready")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("\nTroubleshooting:")
        print("   1. Check network connectivity")
        print("   2. Verify database credentials")
        print("   3. Ensure SSL is enabled")
        sys.exit(1)

if __name__ == "__main__":
    init_neon_database()
