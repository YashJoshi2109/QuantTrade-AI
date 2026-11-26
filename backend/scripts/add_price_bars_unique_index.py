"""
Deduplicate price_bars and enforce one bar per (symbol_id, timestamp).

Concurrent syncs used to insert the same daily bar twice (prod: 63 duplicated
WDAY bars), which crashed the research chart ("data must be asc ordered").
Keeps the newest row (highest id) of each duplicate group, then creates the
unique index the writer's ON CONFLICT relies on. Idempotent.

Run: cd backend && python scripts/add_price_bars_unique_index.py
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.db.database import engine  # noqa: E402

DEDUPE = """
DELETE FROM price_bars p
USING price_bars q
WHERE p.symbol_id = q.symbol_id
  AND p.timestamp = q.timestamp
  AND p.id < q.id
"""
INDEX = ("CREATE UNIQUE INDEX IF NOT EXISTS uq_price_bars_symbol_ts "
         "ON price_bars (symbol_id, timestamp)")


def migrate():
    with engine.connect() as conn:
        if conn.dialect.name != "postgresql":
            print("  skipped (not PostgreSQL)")
            return
        removed = conn.execute(text(DEDUPE)).rowcount
        conn.execute(text(INDEX))
        conn.commit()
        print(f"  Removed {removed} duplicate price_bars rows; uq_price_bars_symbol_ts ensured")
    print("✅ price_bars unique index migration complete")


if __name__ == "__main__":
    migrate()
