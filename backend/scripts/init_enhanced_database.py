"""
Database initialization script with enhanced schema
Creates all tables including new models for fundamentals, portfolios, and real-time quotes
"""
import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine, Base, SessionLocal
from app.models.symbol import Symbol
from app.models.price import PriceBar
from app.models.user import User
from app.models.watchlist import Watchlist
from app.models.news import NewsArticle
from app.models.filing import Filing, FilingChunk
from app.models.chat_history import ChatHistory

# Import new models
from app.models.fundamentals import Fundamentals
from app.models.portfolio import Portfolio, Position, Transaction, PortfolioSnapshot
from app.models.realtime_quote import RealtimeQuote, MarketIndex, QuoteHistory


def init_database():
    """Create all tables in the database"""
    print("🔧 Creating database tables...")
    
    try:
        # Create all tables
        Base.metadata.create_all(bind=engine)
        
        print("✅ Database tables created successfully!")
        print("\n📋 Created tables:")
        print("   • symbols - Stock symbol metadata")
        print("   • price_bars - Historical OHLCV data")
        print("   • users - User accounts")
        print("   • watchlists - User watchlists")
        print("   • news_articles - News articles")
        print("   • filings - SEC filings")
        print("   • filing_chunks - Filing chunks for RAG")
        print("   • chat_history - Chat history")
        print("\n   🆕 NEW TABLES:")
        print("   • fundamentals - Comprehensive fundamental data (Finviz)")
        print("   • realtime_quotes - Real-time price quotes (sub-second updates)")
        print("   • market_indices - Major market indices (S&P, NASDAQ, DOW)")
        print("   • quote_history - Intraday tick data")
        print("   • portfolios - User portfolio accounts")
        print("   • positions - Current holdings in portfolios")
        print("   • transactions - Trade history")
        print("   • portfolio_snapshots - Daily performance snapshots")
        
        # Verify tables exist
        from sqlalchemy import inspect
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        
        print(f"\n✅ Total tables in database: {len(tables)}")
        
        # Create indexes for performance
        print("\n🔧 Creating additional indexes...")
        db = SessionLocal()
        try:
            # Add any custom indexes here if needed
            db.execute("CREATE INDEX IF NOT EXISTS idx_fundamentals_symbol ON fundamentals(symbol_id)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_realtime_quote_symbol ON realtime_quotes(symbol_id)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_position_portfolio ON positions(portfolio_id)")
            db.commit()
            print("✅ Indexes created successfully!")
        except Exception as e:
            print(f"⚠️  Index creation warning: {e}")
        finally:
            db.close()
        
        return True
        
    except Exception as e:
        print(f"❌ Error creating tables: {e}")
        return False


def verify_database():
    """Verify database connection and tables"""
    print("\n🔍 Verifying database...")
    
    try:
        db = SessionLocal()
        
        # Test query
        symbols_count = db.query(Symbol).count()
        users_count = db.query(User).count()
        
        print(f"✅ Database connection successful!")
        print(f"   • Symbols: {symbols_count}")
        print(f"   • Users: {users_count}")
        
        db.close()
        return True
        
    except Exception as e:
        print(f"❌ Database verification failed: {e}")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("  QuantTrade AI - Enhanced Database Initialization")
    print("=" * 60)
    
    if init_database():
        verify_database()
        print("\n" + "=" * 60)
        print("  ✅ Database initialization complete!")
        print("=" * 60)
        print("\n📝 Next steps:")
        print("   1. Start the FastAPI server: uvicorn app.main:app --reload")
        print("   2. Sync S&P 500 data: POST /api/v1/enhanced/sync/sp500?limit=10")
        print("   3. Sync NASDAQ data: POST /api/v1/enhanced/sync/nasdaq?limit=10")
        print("   4. Get real-time quote: GET /api/v1/enhanced/quote/AAPL")
        print("   5. Create portfolio: POST /api/v1/enhanced/portfolio/create")
    else:
        print("\n❌ Database initialization failed!")
        sys.exit(1)
