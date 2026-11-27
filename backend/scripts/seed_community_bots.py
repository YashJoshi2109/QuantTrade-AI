"""
Create the community bot tables and seed the bot accounts. Idempotent.

  1. community_bots, community_bot_posts, community_bot_runs (+ indexes),
     CREATE ... IF NOT EXISTS via checkfirst. New tables only: no existing
     table or column is changed, so this is safe before or after the new
     backend image is live (the app also creates them via create_all).
  2. One user per bot (registry.BOTS): username *_bot, email at the reserved
     bots.quanttrade.invalid domain, no password / Google id / passkey, so the
     account cannot sign in. Plus its community_bots row (enabled = true).
  3. Target communities that do not exist yet (e.g. real-estate) and the bot
     memberships.

Rollback: --drop removes the three tables (bot posts stay as plain posts;
delete them with  DELETE FROM posts WHERE source_platform = 'qt_bot').
Disable without a deploy: COMMUNITY_BOTS_ENABLED=0 or COMMUNITY_BOTS_DISABLED=slug,...

Run: cd backend && python scripts/seed_community_bots.py [--drop]
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import SessionLocal, engine  # noqa: E402
from app.models import community as _community  # noqa: E402,F401  (posts / communities tables)
from app.models import user as _user  # noqa: E402,F401
from app.models.community_bot import CommunityBot, CommunityBotPost, CommunityBotRun  # noqa: E402

TABLES = (CommunityBot.__table__, CommunityBotPost.__table__, CommunityBotRun.__table__)


def migrate():
    for t in TABLES:
        t.create(bind=engine, checkfirst=True)
        for ix in t.indexes:
            ix.create(bind=engine, checkfirst=True)
    print("✅ community bot tables ready")
    from app.services.community_bots.accounts import ensure_bot_accounts

    db = SessionLocal()
    try:
        stats = ensure_bot_accounts(db)
    finally:
        db.close()
    print(f"✅ community bots seeded: {stats}")


def rollback():
    for t in reversed(TABLES):
        t.drop(bind=engine, checkfirst=True)
    print("✅ community bot tables dropped")


if __name__ == "__main__":
    if engine is None:
        print("  skipped (DATABASE_URL not set)")
        sys.exit(0)
    rollback() if "--drop" in sys.argv else migrate()
