"""
Create the marketwatch_lists / marketwatch_items tables (multiple named watchlists).

The app also creates them on startup via Base.metadata.create_all; this script
creates them ahead of a deploy. Idempotent (checkfirst). Existing classic
watchlist rows are not copied here: each user's default list is seeded from
them on first read (app.services.marketwatch.ensure_lists).
Run: cd backend && python scripts/create_marketwatch_tables.py
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine
from app.models.user import User  # noqa: F401  (FK target must be registered)
from app.models.marketwatch import MarketwatchItem, MarketwatchList


def migrate():
    for table in (MarketwatchList.__table__, MarketwatchItem.__table__):
        try:
            table.create(bind=engine, checkfirst=True)
            print(f"  {table.name} table ready")
        except Exception as ex:
            print(f"  Warning ({table.name}): {ex}")
    print("Migration complete: marketwatch")


if __name__ == "__main__":
    migrate()
