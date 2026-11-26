"""
User-defined price / indicator alerts.

One row per alert. The scheduled evaluator (app.services.price_alert_service)
checks active alerts, and when a condition is met it writes an in-app
Notification (type="price_alert") and, for Pro users who opted in, an email.

Lifecycle:
  active --(condition met)--> triggered            (one-shot, repeat=False)
  active --(condition met)--> active, armed=False  (repeat=True; re-arms once
                                                    the condition is false again,
                                                    so a level that stays crossed
                                                    does not spam every run)
  active <--> paused                               (user toggles)
"""
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.sql import func

from app.db.database import Base


class PriceAlert(Base):
    __tablename__ = "price_alerts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(12), nullable=False)
    # price_above | price_below | change_up_pct | change_down_pct | rsi_above | rsi_below
    condition = Column(String(24), nullable=False)
    threshold = Column(Float, nullable=False)
    status = Column(String(12), nullable=False, default="active")  # active | triggered | paused
    repeat = Column(Boolean, nullable=False, default=False)
    armed = Column(Boolean, nullable=False, default=True)
    notify_email = Column(Boolean, nullable=False, default=False)
    note = Column(String(200), nullable=True)

    trigger_count = Column(Integer, nullable=False, default=0)
    last_triggered_at = Column(DateTime(timezone=True), nullable=True)
    last_triggered_value = Column(Float, nullable=True)
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_value = Column(Float, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_price_alerts_status_symbol", "status", "symbol"),
    )
