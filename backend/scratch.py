import urllib.parse
from sqlalchemy import create_engine, text

import os as _os
db_url = _os.environ["DATABASE_URL"].replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(db_url)
with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE passkey_credentials ADD COLUMN device_name VARCHAR(255);"))
        conn.commit()
        print("Column added successfully!")
    except Exception as e:
        print("Error:", e)
