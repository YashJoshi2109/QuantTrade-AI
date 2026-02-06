#!/usr/bin/env python3
"""
MVP Lean Migration Script for Neon PostgreSQL

This script creates the additional tables needed for the Lean MVP:
- quote_snapshots: Neon-backed cache for real-time quotes
- news_cache: Neon-backed cache for news with image extraction
- symbols_master: Comprehensive symbol database for search

Also enables pg_trgm extension for trigram fuzzy search.

Usage:
  cd backend
  source .venv/bin/activate
  python scripts/migrate_mvp_lean.py
"""
import os
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.db.database import engine, Base
from app.models.quote_snapshot import QuoteSnapshot
from app.models.news_cache import NewsCache
from app.models.symbols_master import SymbolsMaster


# Raw SQL for trigram indexes (requires pg_trgm extension)
TRIGRAM_INDEXES_SQL = """
-- Enable pg_trgm extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on symbols_master.symbol for fuzzy symbol search
CREATE INDEX IF NOT EXISTS ix_symbols_master_symbol_trgm 
ON symbols_master USING gin (symbol gin_trgm_ops);

-- Trigram index on symbols_master.name for fuzzy company name search
CREATE INDEX IF NOT EXISTS ix_symbols_master_name_trgm 
ON symbols_master USING gin (name gin_trgm_ops);

-- Composite trigram index for combined search
CREATE INDEX IF NOT EXISTS ix_symbols_master_combined_trgm 
ON symbols_master USING gin ((symbol || ' ' || name) gin_trgm_ops);
"""

# Update existing watchlists table to add note field if missing
WATCHLIST_UPDATE_SQL = """
-- Add note column to watchlists if not exists (for PUT /api/watchlist/{symbol})
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'watchlists' AND column_name = 'notes') THEN
        ALTER TABLE watchlists ADD COLUMN notes VARCHAR(500);
    END IF;
END $$;
"""


def run_migration():
    """Run the MVP Lean migration"""
    print("=" * 60)
    print("MVP Lean Migration for Neon PostgreSQL")
    print("=" * 60)
    
    # Create tables using SQLAlchemy models
    print("\n[1/4] Creating new tables...")
    Base.metadata.create_all(bind=engine, tables=[
        QuoteSnapshot.__table__,
        NewsCache.__table__,
        SymbolsMaster.__table__,
    ])
    print("  ✓ quote_snapshots table created")
    print("  ✓ news_cache table created")
    print("  ✓ symbols_master table created")
    
    # Enable pg_trgm and create trigram indexes
    print("\n[2/4] Enabling pg_trgm extension and creating trigram indexes...")
    with engine.connect() as conn:
        for statement in TRIGRAM_INDEXES_SQL.strip().split(';'):
            statement = statement.strip()
            if statement:
                try:
                    conn.execute(text(statement))
                    conn.commit()
                except Exception as e:
                    print(f"  ⚠ Warning: {e}")
    print("  ✓ pg_trgm extension enabled")
    print("  ✓ Trigram indexes created")
    
    # Update watchlists table
    print("\n[3/4] Updating watchlists table...")
    with engine.connect() as conn:
        try:
            conn.execute(text(WATCHLIST_UPDATE_SQL))
            conn.commit()
            print("  ✓ watchlists.notes column ensured")
        except Exception as e:
            print(f"  ⚠ Warning: {e}")
    
    # Verify tables exist
    print("\n[4/4] Verifying migration...")
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('quote_snapshots', 'news_cache', 'symbols_master')
            ORDER BY table_name
        """))
        tables = [row[0] for row in result]
        
        for table in ['news_cache', 'quote_snapshots', 'symbols_master']:
            if table in tables:
                print(f"  ✓ {table} exists")
            else:
                print(f"  ✗ {table} MISSING")
    
    print("\n" + "=" * 60)
    print("Migration complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("  1. Run: python scripts/seed_symbols_master.py")
    print("  2. Restart backend: pm2 restart backend")
    print("")


if __name__ == "__main__":
    run_migration()
