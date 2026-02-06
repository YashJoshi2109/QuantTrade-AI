from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.db.database import Base


class BillingCustomer(Base):
    __tablename__ = "billing_customers"

    # One-to-one with users table
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True, index=True)
    stripe_customer_id = Column(String(255), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", backref="billing_customer", uselist=False)


class Subscription(Base):
    __tablename__ = "subscriptions"

    # Single active subscription per user for now
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True, index=True)
    stripe_subscription_id = Column(String(255), unique=True, nullable=False, index=True)
    status = Column(String(64), nullable=False, index=True)
    price_id = Column(String(255), nullable=False)
    current_period_end = Column(DateTime, nullable=True)
    cancel_at_period_end = Column(Boolean, default=False, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", backref="subscription", uselist=False)


class BillingEvent(Base):
    __tablename__ = "billing_events"

    id = Column(Integer, primary_key=True, index=True)
    stripe_event_id = Column(String(255), unique=True, nullable=False, index=True)
    type = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("stripe_event_id", name="uq_billing_events_stripe_event_id"),
    )

