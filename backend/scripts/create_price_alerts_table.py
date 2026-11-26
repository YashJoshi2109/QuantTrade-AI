"""
Create the price_alerts table (user price / indicator alerts).

The app also creates it on startup via Base.metadata.create_all; this script lets
you create it ahead of a deploy. Idempotent.
Run: cd backend && python scripts/create_price_alerts_table.py
"""
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine
from app.models.user import User  # noqa: F401  (FK target must be registered)
from app.models.price_alert import PriceAlert


def migrate():
    try:
        PriceAlert.__table__.create(bind=engine, checkfirst=True)
        print("  price_alerts table ready")
    except Exception as ex:
        print(f"  Warning: {ex}")
    print("Migration complete: price_alerts")


if __name__ == "__main__":
    migrate()
