"""
Migration: Add phone number columns to users table
Run: python scripts/add_user_phone_columns.py
"""
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db.database import engine

def migrate():
    columns = [
        ("country_code", "VARCHAR(10)"),
        ("phone_number", "VARCHAR(20)"),
        ("email_verified_at", "TIMESTAMP"),
        ("otp_verified", "BOOLEAN DEFAULT FALSE"),
    ]
    with engine.connect() as conn:
        for col, defn in columns:
            try:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {defn}"))
                conn.commit()
                print(f"  Added {col}")
            except Exception as ex:
                if "already exists" in str(ex).lower() or "duplicate" in str(ex).lower():
                    print(f"  {col} already exists")
                else:
                    print(f"  ⚠️  {col}: {ex}")
        print("✅ User phone and verification columns migration complete")

if __name__ == "__main__":
    migrate()
