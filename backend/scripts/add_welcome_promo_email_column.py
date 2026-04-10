"""
Add welcome_promo_email_sent_at to users (one-time promo email dedupe).
Run: cd backend && python scripts/add_welcome_promo_email_column.py
"""
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db.database import engine


def migrate():
    with engine.connect() as conn:
        try:
            conn.execute(
                text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_promo_email_sent_at TIMESTAMP"
                )
            )
            conn.commit()
            print("  Added welcome_promo_email_sent_at")
        except Exception as ex:
            print(f"  ⚠️  {ex}")
        print("✅ welcome_promo_email_sent_at migration complete")


if __name__ == "__main__":
    migrate()
