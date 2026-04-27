"""
Add theme_preference column to users table.
Run: cd backend && python scripts/add_theme_preference_column.py
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
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(10) NOT NULL DEFAULT 'light'"
                )
            )
            conn.commit()
            print("  Added theme_preference column")
        except Exception as ex:
            print(f"  Warning: {ex}")
        print("Migration complete: theme_preference")


if __name__ == "__main__":
    migrate()
