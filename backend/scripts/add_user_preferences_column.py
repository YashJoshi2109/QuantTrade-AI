"""
Add preferences_json to users (settings + Pro alert toggles).
Run: cd backend && python scripts/add_user_preferences_column.py
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db.database import engine


def migrate():
    with engine.connect() as conn:
        try:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences_json TEXT")
            )
            conn.commit()
            print("  Added preferences_json")
        except Exception as ex:
            print(f"  ⚠️  {ex}")
        print("✅ preferences_json migration complete")


if __name__ == "__main__":
    migrate()
