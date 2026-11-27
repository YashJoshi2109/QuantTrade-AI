"""
Create the public-dataset tables (SEC FSDS point-in-time facts, Form 4 insider
transactions, 13F holdings + summaries, FINRA short interest + short-sale
volume, macro observations, filing language metrics, load log) and indexes.

New tables only: no existing table or column is changed, so it is safe to run
before or after the new backend image is live. The app also creates them on
startup via Base.metadata.create_all. Idempotent (checkfirst).

Rollback: python scripts/create_public_data_tables.py --drop
          (drops only these tables; nothing else references them).

Run: cd backend && python scripts/create_public_data_tables.py [--drop]
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine  # noqa: E402
from app.models.public_data import PUBLIC_DATA_TABLES  # noqa: E402


def migrate():
    for model in PUBLIC_DATA_TABLES:
        model.__table__.create(bind=engine, checkfirst=True)
        for ix in model.__table__.indexes:
            ix.create(bind=engine, checkfirst=True)
        print(f"✅ {model.__tablename__} ready")


def rollback():
    for model in reversed(PUBLIC_DATA_TABLES):
        model.__table__.drop(bind=engine, checkfirst=True)
        print(f"✅ {model.__tablename__} dropped")


if __name__ == "__main__":
    if engine is None:
        print("  skipped (DATABASE_URL not set)")
        sys.exit(0)
    rollback() if "--drop" in sys.argv else migrate()
