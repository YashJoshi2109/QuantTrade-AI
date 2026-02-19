"""
Migration script: Add conversations table and new columns to chat_history.
Idempotent — safe to run multiple times.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text, inspect
from app.db.database import engine


def run():
    if engine is None:
        print("No DATABASE_URL configured, skipping migration.")
        return

    with engine.begin() as conn:
        inspector = inspect(engine)
        existing_tables = inspector.get_table_names()

        # 1) Create conversations table
        if "conversations" not in existing_tables:
            conn.execute(text("""
                CREATE TABLE conversations (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title VARCHAR(255),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX idx_conversations_user ON conversations(user_id);
            """))
            print("Created conversations table.")
        else:
            print("conversations table already exists.")

        # 2) Add new columns to chat_history (idempotent)
        existing_cols = {c["name"] for c in inspector.get_columns("chat_history")}

        if "conversation_id" not in existing_cols:
            conn.execute(text("""
                ALTER TABLE chat_history
                ADD COLUMN conversation_id VARCHAR(36) REFERENCES conversations(id) ON DELETE CASCADE;
                CREATE INDEX idx_chat_history_conv ON chat_history(conversation_id);
            """))
            print("Added conversation_id to chat_history.")

        if "intent_type" not in existing_cols:
            conn.execute(text("ALTER TABLE chat_history ADD COLUMN intent_type VARCHAR(30);"))
            print("Added intent_type to chat_history.")

        if "payload_json" not in existing_cols:
            conn.execute(text("ALTER TABLE chat_history ADD COLUMN payload_json JSONB;"))
            print("Added payload_json to chat_history.")

        if "as_of" not in existing_cols:
            conn.execute(text("ALTER TABLE chat_history ADD COLUMN as_of TIMESTAMPTZ;"))
            print("Added as_of to chat_history.")

        if "ttl_expires_at" not in existing_cols:
            conn.execute(text("ALTER TABLE chat_history ADD COLUMN ttl_expires_at TIMESTAMPTZ;"))
            print("Added ttl_expires_at to chat_history.")

        # Composite index
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_conv_created
            ON chat_history(conversation_id, created_at);
        """))

    print("Migration complete.")


if __name__ == "__main__":
    run()
