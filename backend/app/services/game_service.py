"""
QuantTrade Life — Game domain service.

Responsibilities:
  - compute_age_from_dob: derive age from stored date_of_birth
  - map_age_to_stage: deterministic stage assignment (no manual override)
  - get_stage_config: seed data per stage (starting wallet, missions, story arc)
  - bootstrap_game: idempotent — create or load character, return full game state
  - ensure_community_groups: seed default guilds if missing
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.user import User
from app.models.game import (
    GameCharacter, GameWallet, GameMission,
    GameCommunityGroup, GameCharacterCommunity,
    LifeStage, MissionStatus,
)


# ─── Age → Stage mapping ──────────────────────────────────────────────────────

def compute_age(dob: date) -> int:
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def map_age_to_stage(age: int) -> LifeStage:
    if age < 18:
        return LifeStage.student
    elif age <= 25:
        return LifeStage.college
    elif age <= 35:
        return LifeStage.early_career
    elif age <= 45:
        return LifeStage.family
    else:
        return LifeStage.mastery


# ─── Stage configuration ──────────────────────────────────────────────────────

STAGE_CONFIGS: dict[LifeStage, dict] = {
    LifeStage.student: {
        "display": "The Apprentice",
        "realm": "Schoolyard Kingdom",
        "description": "You are a young squire learning the language of coin.",
        "starting_cash": 500.0,
        "monthly_salary": 200.0,           # part-time / allowance
        "monthly_expenses": 150.0,
        "avatar_style": "scholar",
        "story_arc": "first_coin",
        "xp_to_next": 300,
        "unlocked_assets": ["cash", "savings_account"],
        "missions": [
            {
                "title": "Save Your First 100 Gold Coins",
                "description": "A kingdom built on saving. Accumulate 100 gold in your treasury.",
                "mission_type": "story",
                "category": "saving",
                "target_metric": "cash_balance",
                "target_value": 100.0,
                "xp_reward": 150,
                "gold_reward": 50,
            },
            {
                "title": "Learn the Law of Compound Interest",
                "description": "Complete the Compound Interest scroll in the learning hall.",
                "mission_type": "daily",
                "category": "education",
                "target_metric": "quiz_score",
                "target_value": 80.0,
                "xp_reward": 100,
                "gold_reward": 30,
            },
            {
                "title": "Track Your Spending for 7 Days",
                "description": "A knight who does not know his expenses cannot guard his treasury.",
                "mission_type": "weekly",
                "category": "budgeting",
                "target_metric": "expense_log_days",
                "target_value": 7.0,
                "xp_reward": 200,
                "gold_reward": 75,
            },
        ],
    },
    LifeStage.college: {
        "display": "The Young Merchant",
        "realm": "Merchant's Crossing",
        "description": "You enter the great marketplace of ideas and opportunity.",
        "starting_cash": 2_000.0,
        "monthly_salary": 1_200.0,
        "monthly_expenses": 900.0,
        "avatar_style": "merchant",
        "story_arc": "first_paycheck",
        "xp_to_next": 500,
        "unlocked_assets": ["cash", "savings_account", "etf", "stock"],
        "missions": [
            {
                "title": "Allocate Your First Paycheck",
                "description": "50% needs, 30% wants, 20% savings — the Sacred Budget Rule.",
                "mission_type": "story",
                "category": "budgeting",
                "target_metric": "savings_rate",
                "target_value": 20.0,
                "xp_reward": 250,
                "gold_reward": 100,
            },
            {
                "title": "Buy Your First ETF",
                "description": "Plant a seed in the Royal Index Fund and watch it grow.",
                "mission_type": "story",
                "category": "investing",
                "target_metric": "etf_holdings_count",
                "target_value": 1.0,
                "xp_reward": 300,
                "gold_reward": 150,
            },
            {
                "title": "Build a 3-Month Emergency Treasury",
                "description": "No knight ventures into battle without a reserve.",
                "mission_type": "weekly",
                "category": "saving",
                "target_metric": "emergency_fund",
                "target_value": 3600.0,
                "xp_reward": 400,
                "gold_reward": 200,
            },
        ],
    },
    LifeStage.early_career: {
        "display": "The Rising Knight",
        "realm": "Trade Citadel",
        "description": "Your career advances. Diversify your holdings and grow your wealth.",
        "starting_cash": 8_000.0,
        "monthly_salary": 4_500.0,
        "monthly_expenses": 2_800.0,
        "avatar_style": "knight",
        "story_arc": "market_boom",
        "xp_to_next": 800,
        "unlocked_assets": ["cash", "etf", "stock", "bond", "crypto", "reit"],
        "missions": [
            {
                "title": "Achieve 70% Diversification Score",
                "description": "Spread your gold across 4+ asset classes to earn the Shield of Balance.",
                "mission_type": "story",
                "category": "investing",
                "target_metric": "diversification_score",
                "target_value": 70.0,
                "xp_reward": 500,
                "gold_reward": 250,
            },
            {
                "title": "Weather the Market Storm",
                "description": "Hold your portfolio through a 15% drawdown without panic-selling.",
                "mission_type": "story",
                "category": "investing",
                "target_metric": "held_through_drawdown",
                "target_value": 1.0,
                "xp_reward": 600,
                "gold_reward": 300,
            },
            {
                "title": "Reach ₹10L Net Worth",
                "description": "The halls of the Trade Citadel open to those with 10 lakh in assets.",
                "mission_type": "weekly",
                "category": "saving",
                "target_metric": "net_worth",
                "target_value": 1_000_000.0,
                "xp_reward": 800,
                "gold_reward": 400,
            },
        ],
    },
    LifeStage.family: {
        "display": "The Lord of the Manor",
        "realm": "Shire of Stability",
        "description": "Your realm grows. Protect your family, manage risk, plan the long game.",
        "starting_cash": 25_000.0,
        "monthly_salary": 9_000.0,
        "monthly_expenses": 6_500.0,
        "avatar_style": "noble",
        "story_arc": "family_responsibility",
        "xp_to_next": 1_200,
        "unlocked_assets": ["cash", "etf", "stock", "bond", "reit", "ipo"],
        "missions": [
            {
                "title": "Secure Your Family Treasury",
                "description": "Set up a 6-month emergency fund and life insurance plan.",
                "mission_type": "story",
                "category": "saving",
                "target_metric": "emergency_fund",
                "target_value": 54_000.0,
                "xp_reward": 700,
                "gold_reward": 350,
            },
            {
                "title": "Allocate 15% to Long-Term Bonds",
                "description": "The patient lord builds fortress walls — stable fixed income.",
                "mission_type": "weekly",
                "category": "investing",
                "target_metric": "bond_allocation_pct",
                "target_value": 15.0,
                "xp_reward": 500,
                "gold_reward": 250,
            },
            {
                "title": "Plan the Children's Education Fund",
                "description": "Open a dedicated education treasury for the next generation.",
                "mission_type": "story",
                "category": "education",
                "target_metric": "education_fund_started",
                "target_value": 1.0,
                "xp_reward": 600,
                "gold_reward": 300,
            },
        ],
    },
    LifeStage.mastery: {
        "display": "The Grand Archmage of Wealth",
        "realm": "Citadel of Mastery",
        "description": "You have seen kingdoms rise and fall. Now optimize, preserve, and mentor.",
        "starting_cash": 80_000.0,
        "monthly_salary": 15_000.0,
        "monthly_expenses": 10_000.0,
        "avatar_style": "sage",
        "story_arc": "wealth_optimization",
        "xp_to_next": 2_000,
        "unlocked_assets": ["cash", "etf", "stock", "bond", "crypto", "reit", "ipo", "commodities"],
        "missions": [
            {
                "title": "Optimize Asset Allocation for Retirement",
                "description": "Rebalance to a 60/40 portfolio with capital preservation focus.",
                "mission_type": "story",
                "category": "investing",
                "target_metric": "rebalanced",
                "target_value": 1.0,
                "xp_reward": 1_000,
                "gold_reward": 500,
            },
            {
                "title": "Run a Monte Carlo Stress Test",
                "description": "Simulate 10,000 retirement paths in the Oracle's Chamber.",
                "mission_type": "story",
                "category": "education",
                "target_metric": "monte_carlo_run",
                "target_value": 1.0,
                "xp_reward": 800,
                "gold_reward": 400,
            },
            {
                "title": "Mentor a Young Apprentice",
                "description": "Share a winning strategy in the community guild hall.",
                "mission_type": "weekly",
                "category": "community",
                "target_metric": "community_posts",
                "target_value": 3.0,
                "xp_reward": 600,
                "gold_reward": 300,
            },
        ],
    },
}


DEFAULT_STORY_ARCS = {
    "first_coin": "Your journey begins. The Coin Master has given you your first pouch of gold.",
    "first_paycheck": "The Guild has paid you for the first time. What will you do with your earnings?",
    "market_boom": "The markets are surging. Rally or wait? The Oracle offers counsel.",
    "family_responsibility": "Your family grows. Wisdom now demands protection over speculation.",
    "wealth_optimization": "Your wealth is vast. The final quest: make it last forever.",
}


# ─── Community group seeds ────────────────────────────────────────────────────

COMMUNITY_SEEDS = [
    {"name": "Apprentice Guild", "slug": "apprentice-guild", "life_stage": LifeStage.student, "icon": "scroll", "color": "#6ea4d8", "description": "For students mastering the basics of coin and commerce."},
    {"name": "Merchant's Circle", "slug": "merchants-circle", "life_stage": LifeStage.college, "icon": "coins", "color": "#48bb78", "description": "Young merchants navigating their first paychecks and investments."},
    {"name": "Knights of Capital", "slug": "knights-of-capital", "life_stage": LifeStage.early_career, "icon": "sword", "color": "#c9a84c", "description": "Rising warriors building portfolios and chasing growth."},
    {"name": "The Noble Council", "slug": "noble-council", "life_stage": LifeStage.family, "icon": "shield", "color": "#e07b54", "description": "Lords and ladies balancing family wealth and stability."},
    {"name": "Archmage Conclave", "slug": "archmage-conclave", "life_stage": LifeStage.mastery, "icon": "crown", "color": "#9b59b6", "description": "Masters of wealth, strategy, and generational legacy."},
    {"name": "The Grand Tavern", "slug": "grand-tavern", "life_stage": None, "icon": "globe", "color": "#718096", "description": "All adventurers welcome. Share stories, strategies, and wisdom.", "is_global": True},
]


def ensure_community_groups(db: Session) -> dict[LifeStage, GameCommunityGroup]:
    """Idempotently seed community guilds and return stage → group mapping."""
    stage_map: dict = {}
    for seed in COMMUNITY_SEEDS:
        existing = db.query(GameCommunityGroup).filter(
            GameCommunityGroup.slug == seed["slug"]
        ).first()
        if not existing:
            group = GameCommunityGroup(
                name=seed["name"],
                slug=seed["slug"],
                description=seed.get("description"),
                life_stage=seed.get("life_stage"),
                icon=seed.get("icon", "shield"),
                color=seed.get("color", "#c9a84c"),
                is_global=seed.get("is_global", False),
            )
            db.add(group)
            db.flush()
            existing = group
        if existing.life_stage:
            stage_map[existing.life_stage] = existing
    db.commit()
    return stage_map


def _assign_community(character: GameCharacter, db: Session) -> None:
    """Auto-assign character to stage guild + global tavern."""
    # Stage-specific guild
    stage_group = db.query(GameCommunityGroup).filter(
        GameCommunityGroup.life_stage == character.life_stage
    ).first()
    # Global tavern
    global_group = db.query(GameCommunityGroup).filter(
        GameCommunityGroup.is_global == True
    ).first()

    for group in [g for g in [stage_group, global_group] if g]:
        already = db.query(GameCharacterCommunity).filter(
            GameCharacterCommunity.character_id == character.id,
            GameCharacterCommunity.group_id == group.id,
        ).first()
        if not already:
            db.add(GameCharacterCommunity(character_id=character.id, group_id=group.id))
            group.member_count = (group.member_count or 0) + 1


def _seed_missions(character: GameCharacter, stage: LifeStage, db: Session) -> None:
    """Create initial missions for a new character."""
    cfg = STAGE_CONFIGS[stage]
    for m in cfg["missions"]:
        mission = GameMission(
            character_id=character.id,
            title=m["title"],
            description=m["description"],
            mission_type=m["mission_type"],
            category=m["category"],
            target_metric=m.get("target_metric"),
            target_value=m.get("target_value"),
            xp_reward=m.get("xp_reward", 100),
            gold_reward=m.get("gold_reward", 50),
            status=MissionStatus.active,
        )
        db.add(mission)


# ─── Bootstrap (main entry point) ────────────────────────────────────────────

def bootstrap_game(user: User, db: Session) -> dict:
    """
    Idempotent game bootstrap:
    1. Validate auth (caller must ensure user is authenticated)
    2. Compute age & stage from DOB (fallback: college if DOB missing)
    3. Create or load GameCharacter
    4. Ensure wallet exists
    5. Ensure missions seeded
    6. Ensure community groups exist + assign user
    7. Return full bootstrap payload
    """
    ensure_community_groups(db)

    # Age + stage
    dob: Optional[date] = getattr(user, "date_of_birth", None)
    age: Optional[int] = compute_age(dob) if dob else None
    stage: LifeStage = map_age_to_stage(age) if age is not None else LifeStage.college
    cfg = STAGE_CONFIGS[stage]

    # ── Character ──────────────────────────────────────────────────────────────
    character = db.query(GameCharacter).filter(
        GameCharacter.user_id == user.id
    ).first()

    is_new = character is None
    if is_new:
        avatar = cfg["avatar_style"]
        # Gender-based avatar default (presentation only)
        gender = getattr(user, "gender", None)
        if gender == "female":
            avatar = "scholar" if avatar == "knight" else avatar
        elif gender == "non-binary":
            avatar = "merchant" if avatar == "knight" else avatar

        character = GameCharacter(
            user_id=user.id,
            name=user.full_name or user.username or "Adventurer",
            avatar_style=avatar,
            gender_presentation=gender,
            life_stage=stage,
            age_at_creation=age,
            current_story_arc=cfg["story_arc"],
            xp_to_next_level=cfg["xp_to_next"],
        )
        db.add(character)
        db.flush()  # get character.id

        # Wallet
        wallet = GameWallet(
            character_id=character.id,
            cash_balance=cfg["starting_cash"],
            salary_monthly=cfg["monthly_salary"],
            monthly_expenses=cfg["monthly_expenses"],
            net_worth=cfg["starting_cash"],
        )
        db.add(wallet)
        db.flush()

        # Missions
        _seed_missions(character, stage, db)

        # Community
        _assign_community(character, db)

        db.commit()
        db.refresh(character)
    else:
        # Refresh wallet net_worth
        if character.wallet:
            w = character.wallet
            invested = sum(
                h.quantity * h.current_price for h in character.holdings
            )
            w.total_invested = invested
            w.net_worth = w.cash_balance + invested + w.emergency_fund - w.total_debt
            db.commit()

    # ── Community groups ───────────────────────────────────────────────────────
    memberships = db.query(GameCharacterCommunity).filter(
        GameCharacterCommunity.character_id == character.id
    ).all()
    group_ids = [m.group_id for m in memberships]
    groups = db.query(GameCommunityGroup).filter(
        GameCommunityGroup.id.in_(group_ids)
    ).all() if group_ids else []

    # ── Active missions ────────────────────────────────────────────────────────
    active_missions = db.query(GameMission).filter(
        GameMission.character_id == character.id,
        GameMission.status == MissionStatus.active,
    ).all()

    # ── Story arc narrative ────────────────────────────────────────────────────
    story_arc_text = DEFAULT_STORY_ARCS.get(
        character.current_story_arc or cfg["story_arc"],
        "Your financial adventure begins."
    )

    wallet = character.wallet

    return {
        "is_new_character": is_new,
        "stage": stage.value,
        "stage_display": cfg["display"],
        "realm": cfg["realm"],
        "age": age,
        "character": {
            "id": character.id,
            "name": character.name,
            "avatar_style": character.avatar_style,
            "life_stage": character.life_stage.value,
            "level": character.level,
            "xp": character.xp,
            "xp_to_next_level": character.xp_to_next_level,
            "streak_days": character.streak_days,
            "financial_confidence": character.financial_confidence,
            "discipline_score": character.discipline_score,
            "risk_appetite": character.risk_appetite,
            "savings_habit": character.savings_habit,
            "emotional_resilience": character.emotional_resilience,
            "diversification_score": character.diversification_score,
            "current_story_arc": character.current_story_arc,
            "story_arc_step": character.story_arc_step,
            "behavioral_profile": character.behavioral_profile or {},
        },
        "wallet": {
            "cash_balance": wallet.cash_balance if wallet else 0,
            "salary_monthly": wallet.salary_monthly if wallet else 0,
            "emergency_fund": wallet.emergency_fund if wallet else 0,
            "total_invested": wallet.total_invested if wallet else 0,
            "total_debt": wallet.total_debt if wallet else 0,
            "net_worth": wallet.net_worth if wallet else 0,
            "gold_coins": wallet.gold_coins if wallet else 0,
            "silver_coins": wallet.silver_coins if wallet else 0,
            "monthly_expenses": wallet.monthly_expenses if wallet else 0,
            "savings_rate": wallet.savings_rate if wallet else 0,
        },
        "missions": [
            {
                "id": m.id,
                "title": m.title,
                "description": m.description,
                "mission_type": m.mission_type,
                "category": m.category,
                "target_metric": m.target_metric,
                "target_value": m.target_value,
                "current_value": m.current_value,
                "xp_reward": m.xp_reward,
                "gold_reward": m.gold_reward,
                "status": m.status.value,
                "progress_pct": round(
                    min(100, (m.current_value / m.target_value * 100))
                    if m.target_value else 0
                ),
            }
            for m in active_missions
        ],
        "community_groups": [
            {
                "id": g.id,
                "name": g.name,
                "slug": g.slug,
                "description": g.description,
                "icon": g.icon,
                "color": g.color,
                "member_count": g.member_count,
                "is_global": g.is_global,
            }
            for g in groups
        ],
        "story_arc": {
            "id": character.current_story_arc,
            "step": character.story_arc_step,
            "narrative": story_arc_text,
        },
        "unlocked_assets": cfg["unlocked_assets"],
    }
