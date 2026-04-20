"""
Seed the 8 default financial communities.
Run: python -m scripts.seed_communities
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import SessionLocal
from app.models.community import Community, CommunityMember
from app.models.user import User

COMMUNITIES = [
    {"slug": "wall-street-bets", "name": "Wall Street Bets", "category": "stocks", "description": "High-risk trades, YOLO plays, and options gambling. The internet's most famous trading community."},
    {"slug": "stocks", "name": "Stocks", "category": "stocks", "description": "Stock market discussion, analysis, and news for all experience levels."},
    {"slug": "investing", "name": "Investing", "category": "macro", "description": "Long-term investing strategies, portfolio management, and market analysis."},
    {"slug": "options-trading", "name": "Options Trading", "category": "options", "description": "Options strategies, Greeks, spreads, and derivatives discussion."},
    {"slug": "cryptocurrency", "name": "Cryptocurrency", "category": "crypto", "description": "Crypto markets, DeFi, blockchain technology, and altcoin analysis."},
    {"slug": "stock-market", "name": "Stock Market", "category": "stocks", "description": "General stock market analysis, sector rotation, and market commentary."},
    {"slug": "thetagang", "name": "Theta Gang", "category": "options", "description": "Premium selling strategies, covered calls, cash-secured puts, and theta decay plays."},
    {"slug": "value-investing", "name": "Value Investing", "category": "stocks", "description": "Value investing, fundamental analysis, DCF models, and long-term compounding."},
]


def seed():
    db = SessionLocal()
    try:
        # Get or create system user (first admin user)
        system_user = db.query(User).filter(User.role == "admin").first()
        if not system_user:
            system_user = db.query(User).first()
        if not system_user:
            print("ERROR: No users in database. Create a user first.")
            return

        created = 0
        for c in COMMUNITIES:
            existing = db.query(Community).filter(Community.slug == c["slug"]).first()
            if existing:
                print(f"  SKIP  {c['slug']} (already exists)")
                continue

            community = Community(
                slug=c["slug"],
                name=c["name"],
                description=c["description"],
                category=c["category"],
                created_by=system_user.id,
                member_count=1,
            )
            db.add(community)
            db.flush()

            db.add(CommunityMember(
                community_id=community.id,
                user_id=system_user.id,
                role="owner",
            ))
            created += 1
            print(f"  CREATE  {c['slug']}")

        db.commit()
        print(f"\nDone: {created} communities created, {len(COMMUNITIES) - created} already existed")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
