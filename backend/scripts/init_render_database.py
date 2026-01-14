"""
Initialize Render PostgreSQL database for production
This script connects to your Render database and creates all tables
"""
import os
import sys
from pathlib import Path

# Add parent directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

# Render Database Connection Strings
# External (for local/outside Render): Use this for local development
RENDER_EXTERNAL_DB = 'postgresql://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a.oregon-postgres.render.com/finance_r6b5'

# Internal (for Render services): Use this when backend is deployed on Render
RENDER_INTERNAL_DB = 'postgresql://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a/finance_r6b5'

# Convert to psycopg format for SQLAlchemy
def convert_to_psycopg(url: str) -> str:
    """Convert postgresql:// to postgresql+psycopg:// for psycopg3"""
    if url.startswith('postgresql://'):
        return url.replace('postgresql://', 'postgresql+psycopg://', 1)
    return url

# Use external for local initialization
render_db_url = convert_to_psycopg(RENDER_EXTERNAL_DB)

# Set database URL before importing models
os.environ['DATABASE_URL'] = render_db_url

from app.db.database import engine, Base
from app.models import symbol, price, news, filing, user, watchlist
from sqlalchemy import text

def init_render_database():
    """Initialize Render PostgreSQL database"""
    print("🚀 Initializing Render PostgreSQL Database...")
    print("=" * 60)
    print(f"📍 Database: finance_r6b5")
    print(f"🌍 Region: Oregon (US West)")
    print("=" * 60)
    
    try:
        # Test connection
        print("🔌 Testing connection...")
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version()"))
            version = result.fetchone()[0]
            print(f"✅ Connected to Render PostgreSQL!")
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
        print("✅ Render database initialization complete!")
        print("\n💡 Your database is ready for production!")
        print("   - Users can now register and login")
        print("   - Data will be stored in Render PostgreSQL")
        print("   - All tables are created and ready")
        print("\n📝 Connection Info:")
        print(f"   External URL: {RENDER_EXTERNAL_DB[:50]}...")
        print(f"   Internal URL: {RENDER_INTERNAL_DB[:50]}...")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("\nTroubleshooting:")
        print("   1. Check network connectivity")
        print("   2. Verify database credentials")
        print("   3. Ensure database is accessible (not in private network)")
        print("   4. Check if database status is 'Available' in Render dashboard")
        sys.exit(1)

if __name__ == "__main__":
    init_render_database()
