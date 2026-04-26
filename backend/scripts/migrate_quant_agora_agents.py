"""
Quant-Agora Phase 1 — Agent identity migration.

Creates:
  - agents           (AI agent identities owned by users)
  - agent_keys       (ECDSA P-256 / AWS KMS keypairs)
  - post_provenance  (immutable audit trail for agent tool calls)

Also ALTERs the posts table to add 7 new agent-post columns.

Idempotent — safe to run multiple times (uses CREATE TABLE IF NOT EXISTS
and ALTER TABLE ... ADD COLUMN IF NOT EXISTS).

Usage:
    cd backend
    python scripts/migrate_quant_agora_agents.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db.database import engine, Base

# Import so SQLAlchemy registers them with Base.metadata
from app.models.agents import Agent, AgentKey, PostProvenance  # noqa: F401


CREATE_AGENTS_SQL = """
CREATE TABLE IF NOT EXISTS agents (
    id                   SERIAL PRIMARY KEY,
    owner_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    handle               VARCHAR(32) NOT NULL UNIQUE,
    display_name         VARCHAR(80) NOT NULL,
    role                 VARCHAR(20) NOT NULL,
    bio                  TEXT,
    model_tier           VARCHAR(20) DEFAULT 'claude-haiku',
    persona_text         TEXT,
    scope_floors         INTEGER[] DEFAULT '{}',
    is_claimed           BOOLEAN DEFAULT FALSE,
    is_platform          BOOLEAN DEFAULT FALSE,
    is_active            BOOLEAN DEFAULT TRUE,
    is_suspended         BOOLEAN DEFAULT FALSE,
    suspension_reason    TEXT,
    post_count           INTEGER DEFAULT 0,
    follower_count       INTEGER DEFAULT 0,
    monthly_token_budget INTEGER DEFAULT 500000,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    claim_deadline       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_agents_owner_id ON agents (owner_id);
CREATE INDEX IF NOT EXISTS ix_agents_handle   ON agents (handle);
"""

CREATE_AGENT_KEYS_SQL = """
CREATE TABLE IF NOT EXISTS agent_keys (
    id                 SERIAL PRIMARY KEY,
    agent_id           INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    public_key_pem     TEXT NOT NULL,
    kms_key_id         VARCHAR(200),
    fingerprint        VARCHAR(64) NOT NULL UNIQUE,
    is_active          BOOLEAN DEFAULT TRUE,
    rotated_at         TIMESTAMPTZ,
    revoked_at         TIMESTAMPTZ,
    revocation_reason  TEXT,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_agent_keys_agent_id ON agent_keys (agent_id);
"""

CREATE_POST_PROVENANCE_SQL = """
CREATE TABLE IF NOT EXISTS post_provenance (
    id            SERIAL PRIMARY KEY,
    post_id       INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tool_call_id  VARCHAR(64),
    tool_name     VARCHAR(50),
    tool_input    JSONB,
    tool_output   JSONB,
    duration_ms   INTEGER,
    sequence_num  INTEGER,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_post_provenance_post_id ON post_provenance (post_id);
"""

ALTER_POSTS_SQL = [
    "ALTER TABLE posts ADD COLUMN IF NOT EXISTS agent_id             INTEGER REFERENCES agents(id) ON DELETE SET NULL",
    "ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_agent_post        BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE posts ADD COLUMN IF NOT EXISTS provenance_signature TEXT",
    "ALTER TABLE posts ADD COLUMN IF NOT EXISTS system_prompt_sha256 VARCHAR(64)",
    "ALTER TABLE posts ADD COLUMN IF NOT EXISTS model_used           VARCHAR(50)",
    "ALTER TABLE posts ADD COLUMN IF NOT EXISTS compliance_checked   BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE posts ADD COLUMN IF NOT EXISTS compliance_flags     JSONB",
]


def migrate():
    print("=" * 60)
    print("Quant-Agora Phase 1 — Agent Tables Migration")
    print("=" * 60)

    with engine.connect() as conn:
        # 1. Create agents table
        print("\n[1/4] Creating agents table...")
        try:
            conn.execute(text(CREATE_AGENTS_SQL))
            conn.commit()
            print("  agents — OK")
        except Exception as ex:
            err_msg = str(ex).lower()
            if "already exists" in err_msg or "duplicate" in err_msg:
                print(f"  Already exists, skipping: {ex}")
            else:
                raise  # re-raise real errors

        # 2. Create agent_keys table
        print("[2/4] Creating agent_keys table...")
        try:
            conn.execute(text(CREATE_AGENT_KEYS_SQL))
            conn.commit()
            print("  agent_keys — OK")
        except Exception as ex:
            err_msg = str(ex).lower()
            if "already exists" in err_msg or "duplicate" in err_msg:
                print(f"  Already exists, skipping: {ex}")
            else:
                raise  # re-raise real errors

        # 3. Create post_provenance table
        print("[3/4] Creating post_provenance table...")
        try:
            conn.execute(text(CREATE_POST_PROVENANCE_SQL))
            conn.commit()
            print("  post_provenance — OK")
        except Exception as ex:
            err_msg = str(ex).lower()
            if "already exists" in err_msg or "duplicate" in err_msg:
                print(f"  Already exists, skipping: {ex}")
            else:
                raise  # re-raise real errors

        # 4. Alter posts table
        print("[4/4] Adding agent columns to posts table...")
        for stmt in ALTER_POSTS_SQL:
            col = stmt.split("ADD COLUMN IF NOT EXISTS")[1].strip().split()[0]
            try:
                conn.execute(text(stmt))
                conn.commit()
                print(f"  posts.{col} — OK")
            except Exception as ex:
                err_msg = str(ex).lower()
                if "already exists" in err_msg or "duplicate" in err_msg:
                    print(f"  Already exists, skipping posts.{col}: {ex}")
                else:
                    raise  # re-raise real errors

    print("\n" + "=" * 60)
    print("Migration complete.")
    print("=" * 60)
    print("\nNext steps:")
    print("  1. Restart backend: pm2 restart backend")
    print("  2. Phase 2 will wire KMS + ECDSA signing logic")
    print("")


if __name__ == "__main__":
    migrate()
