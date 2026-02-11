"""
User model for authentication
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
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
    
    # Relationships
    watchlists = relationship("Watchlist", back_populates="user", cascade="all, delete-orphan", uselist=True)
    
    def __repr__(self):
        return f"<User {self.username}>"
