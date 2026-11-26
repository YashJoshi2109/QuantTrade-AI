"""
Add the performance-history columns to portfolio_snapshots.

portfolio_snapshots already exists (Base.metadata.create_all), but create_all
never adds columns to an existing table. Idempotent: safe to run on every deploy.
Run: cd backend && python scripts/add_portfolio_snapshot_columns.py
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import inspect, text

from app.db.database import engine
from app.models.user import User  # noqa: F401  (FK target must be registered)
from app.models.portfolio import Portfolio, PortfolioSnapshot  # noqa: F401

COLUMNS = {
    "cost_basis": "DOUBLE PRECISION",
    "net_flow": "DOUBLE PRECISION",
    "source": "VARCHAR(16)",
    "missing_symbols": "VARCHAR(500)",
}


def migrate(bind=None):
    bind = bind or engine
    PortfolioSnapshot.__table__.create(bind=bind, checkfirst=True)
    existing = {c["name"] for c in inspect(bind).get_columns("portfolio_snapshots")}
    with bind.begin() as conn:
        for name, ddl in COLUMNS.items():
            if name in existing:
                print(f"  portfolio_snapshots.{name} already present")
                continue
            conn.execute(text(f"ALTER TABLE portfolio_snapshots ADD COLUMN {name} {ddl}"))
            print(f"  added portfolio_snapshots.{name}")
    print("Migration complete: portfolio_snapshots history columns")


if __name__ == "__main__":
    migrate()
