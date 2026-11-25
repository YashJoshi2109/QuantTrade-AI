"""
Initialize database tables for production
Run this script to create all necessary tables in your PostgreSQL database
"""
import sys
import os
from pathlib import Path

# Add parent directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from app.db.database import engine, Base
# Import ALL models to ensure they're registered with SQLAlchemy
from app.models import (
    Symbol, PriceBar, Watchlist, NewsArticle, Filing, FilingChunk, ChatHistory,
    Fundamentals, Portfolio, Position, Transaction, TransactionType, 
    PortfolioSnapshot, RealtimeQuote, MarketIndex, QuoteHistory
)
from app.models.user import User
from sqlalchemy import text

def init_database():
    """Create all database tables"""
    print("🚀 Initializing database...")
    print("=" * 60)
    
    try:
        # Test connection
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version()"))
            version = result.fetchone()[0]
            print(f"✅ Connected to PostgreSQL: {version[:50]}...")
        
        # Create all tables
        print("\n📋 Creating tables...")
        Base.metadata.create_all(bind=engine)
        print("✅ All tables created successfully!")
        
        # Verify tables were created
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
                print(f"   - {table}")
        
        # Check if pgvector extension is available
        print("\n🔍 Checking pgvector extension...")
        try:
            with engine.connect() as conn:
                result = conn.execute(text("SELECT * FROM pg_extension WHERE extname = 'vector'"))
                if result.fetchone():
                    print("✅ pgvector extension is installed")
                else:
                    print("⚠️  pgvector extension not found (optional for vector search)")
        except Exception as e:
            print(f"⚠️  Could not check pgvector: {e}")
        
        print("\n" + "=" * 60)
        print("✅ Database initialization complete!")
        print("\n💡 Next steps:")
        print("   1. Run data sync: python scripts/sync_data.py")
        print("   2. Start your backend server")
        print("   3. Test API endpoints")
        
    except Exception as e:
        print(f"\n❌ Error initializing database: {e}")
        print("\nTroubleshooting:")
        print("   1. Check DATABASE_URL is set correctly")
        print("   2. Verify database is accessible")
        print("   3. Check network connectivity")
        sys.exit(1)

if __name__ == "__main__":
    init_database()
