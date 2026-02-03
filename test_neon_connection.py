#!/usr/bin/env python
"""Test Neon database connection"""
import os
import sys

# Set Neon connection string
os.environ['NEON_DATABASE_URL'] = "postgresql+psycopg://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require"

sys.path.insert(0, '/Users/yash/Downloads/Finance/backend')

try:
    from app.config import settings
    print("✅ Config loaded")
    print(f"✅ Database URL: {settings.DATABASE_URL[:60]}...")
    
    from app.db.database import engine
    print("✅ Database engine created")
    
    from sqlalchemy import text
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1 as test"))
        print("✅ Neon database connection successful!")
        print(f"✅ Test query result: {result.fetchone()}")
        
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
