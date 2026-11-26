"""
Add an index on portfolios.user_id (the /api/v1/portfolios list query filters on it).
Idempotent. New databases get it from the model via create_all.
Run: cd backend && python scripts/add_portfolio_user_index.py
"""
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db.database import engine


def migrate():
    with engine.connect() as conn:
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_portfolios_user_id ON portfolios (user_id)"))
            conn.commit()
            print("  Added ix_portfolios_user_id")
        except Exception as ex:
            print(f"  Warning: {ex}")
        print("Migration complete: portfolios.user_id index")


if __name__ == "__main__":
    migrate()
