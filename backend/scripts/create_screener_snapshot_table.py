"""
Create the screener_snapshots table (stock screener, /api/v1/screener) and its indexes.

The app also creates it on startup via Base.metadata.create_all, and the API fills
it on first request; this script lets you create it ahead of a deploy. Idempotent.
Pass --build to also compute the snapshot now (reads only our DB, no external calls).
Run: cd backend && python scripts/create_screener_snapshot_table.py [--build]
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine, SessionLocal
from app.models.symbol import Symbol  # noqa: F401  (FK target must be registered)
from app.models.screener_snapshot import ScreenerSnapshot


def migrate(build: bool = False):
    try:
        ScreenerSnapshot.__table__.create(bind=engine, checkfirst=True)
        for ix in ScreenerSnapshot.__table__.indexes:
            ix.create(bind=engine, checkfirst=True)
        print("  screener_snapshots table ready")
    except Exception as ex:
        print(f"  Warning: {ex}")
    if build:
        from app.services.screener_service import rebuild_snapshot

        db = SessionLocal()
        try:
            print(f"  screener snapshot rows: {rebuild_snapshot(db)}")
        finally:
            db.close()
    print("Migration complete: screener_snapshots")


if __name__ == "__main__":
    migrate(build="--build" in sys.argv)
