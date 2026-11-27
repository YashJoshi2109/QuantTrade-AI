"""
Add price_alerts.last_event_key (earnings pre-alerts fire once per report).

Idempotent: does nothing when the column exists. The app also runs the same
check on startup (app.models.price_alert.ensure_price_alert_columns).
Run: cd backend && python scripts/add_price_alert_event_key_column.py
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine
from app.models.user import User  # noqa: F401  (FK target must be registered)
from app.models.price_alert import ensure_price_alert_columns


def migrate():
    try:
        ensure_price_alert_columns(engine)
        print("  price_alerts.last_event_key ready")
    except Exception as ex:
        print(f"  Warning: {ex}")
    print("Migration complete: price_alerts.last_event_key")


if __name__ == "__main__":
    migrate()
