"""
Migration: Remove deprecated area_code column from users table.
Run: python scripts/remove_area_code_column.py
"""
import os
import sys

from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine


def migrate():
  with engine.connect() as conn:
    try:
      conn.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS area_code"))
      conn.commit()
      print("✅ Dropped users.area_code column (if it existed)")
    except Exception as ex:
      print(f"⚠️  Failed to drop area_code column: {ex}")


if __name__ == "__main__":
  migrate()

