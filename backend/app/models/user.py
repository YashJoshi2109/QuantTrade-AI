"""
User model for authentication
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Date
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.database import Base


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=True)  # Nullable for OAuth users
    full_name = Column(String(255), nullable=True)
    
    # OAuth fields
    google_id = Column(String(255), unique=True, nullable=True)
    avatar_url = Column(Text, nullable=True)

    # Phone number (country code + phone)
    country_code = Column(String(10), nullable=True)
    phone_number = Column(String(20), nullable=True)

    # Game profile fields (collected at signup, used for life-stage mapping)
    date_of_birth = Column(Date, nullable=True)
    gender = Column(String(20), nullable=True)  # male | female | non-binary | prefer_not_to_say

    # Email verification
    email_verified_at = Column(DateTime, nullable=True)
    otp_verified = Column(Boolean, default=False)

    # Account status
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)

    # One-time welcome email with Stripe promo (deduped; see welcome_promo_email_service)
    welcome_promo_email_sent_at = Column(DateTime, nullable=True)

    # JSON preferences: analyst_personality, data_sources, notifications, pro_watchlist_email_alerts, etc.
    preferences_json = Column(Text, nullable=True)

    # Theme preference: persisted across devices ("light" | "dark")
    theme_preference = Column(String(10), default="light", nullable=False, server_default="light")

    # Community profile fields
    bio = Column(Text, nullable=True)
    trading_style = Column(String(50), nullable=True)  # day_trader, swing, long_term, options
    experience = Column(String(20), nullable=True)  # beginner, intermediate, advanced, expert
    reputation = Column(Integer, default=0)
    post_count = Column(Integer, default=0)
    follower_count = Column(Integer, default=0)
    following_count = Column(Integer, default=0)
    
    # Relationships
    watchlists = relationship("Watchlist", back_populates="user", cascade="all, delete-orphan", uselist=True)
    
    def __repr__(self):
        return f"<User {self.username}>"
