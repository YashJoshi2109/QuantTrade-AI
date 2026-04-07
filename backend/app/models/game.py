"""
QuantTrade Life — Game domain models.

Tables:
  game_characters      — one per user; persists avatar, stage, XP, traits
  game_wallets         — virtual treasury; cash, salary, net worth
  game_missions        — daily/weekly quests assigned per stage
  game_community_groups— stage-based guilds auto-assigned on bootstrap
  game_portfolio_holdings — simulated asset positions
  game_events_log      — scenario events applied to character
"""
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text,
    Float, ForeignKey, JSON, Enum as SAEnum, Date,
)
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from app.db.database import Base


class LifeStage(str, enum.Enum):
    student = "student"
    college = "college"
    early_career = "early_career"
    family = "family"
    mastery = "mastery"


class MissionStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    completed = "completed"
    failed = "failed"


class AssetType(str, enum.Enum):
    stock = "stock"
    etf = "etf"
    bond = "bond"
    crypto = "crypto"
    cash = "cash"
    reit = "reit"


# ─── Character ────────────────────────────────────────────────────────────────

class GameCharacter(Base):
    __tablename__ = "game_characters"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)

    # Identity
    name = Column(String(100), nullable=False, default="Adventurer")
    avatar_style = Column(String(50), nullable=False, default="knight")  # knight | scholar | merchant | noble | sage
    gender_presentation = Column(String(20), nullable=True)  # used only for avatar defaults

    # Life stage (server-computed from DOB; never manually set by user)
    life_stage = Column(SAEnum(LifeStage), nullable=False, default=LifeStage.student)
    age_at_creation = Column(Integer, nullable=True)

    # Progression
    level = Column(Integer, default=1)
    xp = Column(Integer, default=0)
    xp_to_next_level = Column(Integer, default=500)
    streak_days = Column(Integer, default=0)
    last_active_date = Column(Date, nullable=True)

    # Financial traits (0–100 scores)
    financial_confidence = Column(Float, default=30.0)
    discipline_score = Column(Float, default=40.0)
    risk_appetite = Column(Float, default=50.0)
    savings_habit = Column(Float, default=30.0)
    emotional_resilience = Column(Float, default=40.0)
    diversification_score = Column(Float, default=20.0)

    # Behavioral flags
    behavioral_profile = Column(JSON, default=dict)  # {"panic_sell": 0, "overtrading": 0, "fomo": 0}

    # Story arc
    current_story_arc = Column(String(100), nullable=True, default="first_paycheck")
    story_arc_step = Column(Integer, default=0)
    story_flags = Column(JSON, default=dict)  # arbitrary milestone flags

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    wallet = relationship("GameWallet", back_populates="character", uselist=False, cascade="all, delete-orphan")
    missions = relationship("GameMission", back_populates="character", cascade="all, delete-orphan")
    holdings = relationship("GamePortfolioHolding", back_populates="character", cascade="all, delete-orphan")
    events = relationship("GameEventLog", back_populates="character", cascade="all, delete-orphan")


# ─── Wallet (Treasury) ────────────────────────────────────────────────────────

class GameWallet(Base):
    __tablename__ = "game_wallets"

    id = Column(Integer, primary_key=True, index=True)
    character_id = Column(Integer, ForeignKey("game_characters.id", ondelete="CASCADE"), unique=True, nullable=False)

    # Treasury state
    cash_balance = Column(Float, default=0.0)          # liquid gold coins
    salary_monthly = Column(Float, default=0.0)        # income per month tick
    emergency_fund = Column(Float, default=0.0)        # safety treasury
    total_invested = Column(Float, default=0.0)        # in portfolio
    total_debt = Column(Float, default=0.0)            # liabilities
    net_worth = Column(Float, default=0.0)             # computed

    # Coin system (gamification layer)
    gold_coins = Column(Integer, default=0)            # earned via quests/XP
    silver_coins = Column(Integer, default=0)

    # Expense tracking
    monthly_expenses = Column(Float, default=0.0)
    savings_rate = Column(Float, default=0.0)          # %

    # Snapshot history (JSON array of {date, net_worth})
    net_worth_history = Column(JSON, default=list)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    character = relationship("GameCharacter", back_populates="wallet")


# ─── Missions (Quests) ────────────────────────────────────────────────────────

class GameMission(Base):
    __tablename__ = "game_missions"

    id = Column(Integer, primary_key=True, index=True)
    character_id = Column(Integer, ForeignKey("game_characters.id", ondelete="CASCADE"), nullable=False, index=True)

    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    mission_type = Column(String(50), nullable=False)  # daily | weekly | story | bonus
    category = Column(String(50), nullable=True)        # saving | investing | budgeting | education | community

    # Target metric
    target_metric = Column(String(100), nullable=True)  # "savings_rate" | "invest_amount" | "quiz_score"
    target_value = Column(Float, nullable=True)
    current_value = Column(Float, default=0.0)

    # Rewards
    xp_reward = Column(Integer, default=100)
    gold_reward = Column(Integer, default=50)

    status = Column(SAEnum(MissionStatus), default=MissionStatus.active)
    expires_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    character = relationship("GameCharacter", back_populates="missions")


# ─── Community Groups (Guilds) ────────────────────────────────────────────────

class GameCommunityGroup(Base):
    __tablename__ = "game_community_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    slug = Column(String(50), unique=True, nullable=False)
    description = Column(Text, nullable=True)
    life_stage = Column(SAEnum(LifeStage), nullable=True)  # None = global guild
    icon = Column(String(50), default="shield")
    color = Column(String(20), default="#c9a84c")           # medieval gold
    member_count = Column(Integer, default=0)
    is_global = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class GameCharacterCommunity(Base):
    """Junction: character ↔ community group membership"""
    __tablename__ = "game_character_communities"

    id = Column(Integer, primary_key=True, index=True)
    character_id = Column(Integer, ForeignKey("game_characters.id", ondelete="CASCADE"), nullable=False)
    group_id = Column(Integer, ForeignKey("game_community_groups.id", ondelete="CASCADE"), nullable=False)
    reputation = Column(Integer, default=0)
    joined_at = Column(DateTime, default=datetime.utcnow)


# ─── Portfolio Holdings ───────────────────────────────────────────────────────

class GamePortfolioHolding(Base):
    __tablename__ = "game_portfolio_holdings"

    id = Column(Integer, primary_key=True, index=True)
    character_id = Column(Integer, ForeignKey("game_characters.id", ondelete="CASCADE"), nullable=False, index=True)

    symbol = Column(String(20), nullable=False)
    name = Column(String(100), nullable=True)
    asset_type = Column(SAEnum(AssetType), nullable=False, default=AssetType.stock)
    quantity = Column(Float, default=0.0)
    avg_cost = Column(Float, default=0.0)
    current_price = Column(Float, default=0.0)
    pnl = Column(Float, default=0.0)
    allocation_pct = Column(Float, default=0.0)
    purchased_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    character = relationship("GameCharacter", back_populates="holdings")


# ─── Event Log ────────────────────────────────────────────────────────────────

class GameEventLog(Base):
    __tablename__ = "game_event_logs"

    id = Column(Integer, primary_key=True, index=True)
    character_id = Column(Integer, ForeignKey("game_characters.id", ondelete="CASCADE"), nullable=False, index=True)

    event_type = Column(String(100), nullable=False)    # "market_crash" | "promotion" | "emergency_expense"
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    financial_impact = Column(Float, default=0.0)       # +/- on wallet
    xp_impact = Column(Integer, default=0)
    decision_made = Column(String(200), nullable=True)  # what the user chose
    outcome = Column(Text, nullable=True)               # AI-narrated result

    occurred_at = Column(DateTime, default=datetime.utcnow)
    character = relationship("GameCharacter", back_populates="events")
