import urllib.parse
from sqlalchemy import create_engine, text

db_url = "postgresql+psycopg://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

engine = create_engine(db_url)
with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE passkey_credentials ADD COLUMN device_name VARCHAR(255);"))
        conn.commit()
        print("Column added successfully!")
    except Exception as e:
        print("Error:", e)
