"""Idempotent seeding of bot user accounts, bot rows, target communities and memberships.

Bot users cannot sign in: no password hash, no Google id, no passkey, and an
email on the reserved ``.invalid`` TLD (RFC 2606) so OTP / reset mail can
never be delivered. ``app.api.auth`` additionally refuses any token whose
user is a bot (``is_bot_email``).
"""
from __future__ import annotations

from typing import Dict

from sqlalchemy.orm import Session

from app.services.community_bots.registry import (
    BOT_COMMUNITIES, BOT_EMAIL_DOMAIN, all_specs, bot_email,
)


def is_bot_email(email: str | None) -> bool:
    return bool(email) and email.strip().lower().endswith("@" + BOT_EMAIL_DOMAIN)


def ensure_bot_accounts(db: Session) -> Dict[str, int]:
    from app.models.community import Community, CommunityMember
    from app.models.community_bot import CommunityBot
    from app.models.user import User

    stats = {"users": 0, "bots": 0, "communities": 0, "memberships": 0}
    users: Dict[str, User] = {}
    for spec in all_specs():
        email = bot_email(spec)
        u = db.query(User).filter(User.email == email).first()
        if u is None:
            taken = db.query(User).filter(User.username == spec.username).first()
            if taken is not None:
                raise RuntimeError(f"username {spec.username} is taken by a non-bot account (id {taken.id})")
            u = User(email=email, username=spec.username, full_name=spec.display_name,
                     hashed_password=None, google_id=None, is_active=True, is_verified=False,
                     otp_verified=False, bio=f"Automated account. {spec.tagline}",
                     trading_style=None, experience=None)
            db.add(u)
            db.flush()
            stats["users"] += 1
        else:
            # Keep the account non-loginable even if someone edited it.
            u.hashed_password = None
            u.google_id = None
            u.full_name = spec.display_name
            u.bio = f"Automated account. {spec.tagline}"
        users[spec.slug] = u
        bot = db.query(CommunityBot).filter(CommunityBot.slug == spec.slug).first()
        if bot is None:
            db.add(CommunityBot(slug=spec.slug, user_id=u.id, enabled=True))
            stats["bots"] += 1
        elif bot.user_id != u.id:
            bot.user_id = u.id
    db.flush()

    owners = {}
    for spec in all_specs():
        owners.setdefault(spec.community_slug, users[spec.slug])
    for slug, name, category, desc in BOT_COMMUNITIES:
        if db.query(Community).filter(Community.slug == slug).first() is None and slug in owners:
            c = Community(slug=slug, name=name, category=category, description=desc,
                          created_by=owners[slug].id, member_count=0, post_count=0)
            db.add(c)
            db.flush()
            stats["communities"] += 1

    for spec in all_specs():
        c = db.query(Community).filter(Community.slug == spec.community_slug).first()
        if c is None:
            continue
        u = users[spec.slug]
        if not db.query(CommunityMember).filter(CommunityMember.community_id == c.id,
                                                CommunityMember.user_id == u.id).first():
            role = "owner" if c.created_by == u.id else "member"
            db.add(CommunityMember(community_id=c.id, user_id=u.id, role=role))
            c.member_count = (c.member_count or 0) + 1
            stats["memberships"] += 1
    db.commit()
    return stats
