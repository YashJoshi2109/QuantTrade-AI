"""
Add symbols lifecycle columns (is_active, delisted_at, successor_symbol,
status_note) and mark the audited retired tickers inactive with their
successor (app.services.ticker_lifecycle.RETIREMENTS).

Idempotent: columns are only added when missing, and retirements only write
rows whose values differ. Never deletes rows (watchlists/portfolios/history
reference them). The app runs the column step on startup too.

Run: cd backend && python scripts/add_symbol_lifecycle_columns.py
Deploy runs it in the backend container after inject_aws_secrets().
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def migrate(engine=None, session_factory=None) -> dict:
    from app.models.symbol import ensure_symbol_lifecycle_columns
    from app.services.ticker_lifecycle import apply_retirements

    if engine is None or session_factory is None:
        from app.db.database import SessionLocal, engine as default_engine

        engine = engine or default_engine
        session_factory = session_factory or SessionLocal
    if engine is None:
        print("No database configured (DATABASE_URL); nothing to migrate.")
        return {}
    added = ensure_symbol_lifecycle_columns(engine)
    print(f"  symbols lifecycle columns added: {added or 'none (already present)'}")
    db = session_factory()
    try:
        result = apply_retirements(db)
    finally:
        db.close()
    print(f"  retirements applied: {result}")
    print("Migration complete: symbols lifecycle")
    return {"added": added, **result}


if __name__ == "__main__":
    migrate()
