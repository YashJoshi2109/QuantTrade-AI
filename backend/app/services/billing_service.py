"""
Billing service utilities

Implementation Notes:
- Centralizes Stripe-related persistence logic
- Provides helper for premium access checks
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.billing import BillingCustomer, Subscription, BillingEvent
from app.models.user import User


def get_or_create_billing_customer(
    db: Session, user: User, stripe_customer_id: Optional[str] = None
) -> BillingCustomer:
    """
    Ensure a BillingCustomer exists for the given user.
    If a Stripe customer ID is provided, it is used; otherwise caller must
    create the Stripe customer first and then pass the ID here.
    """
    billing_customer = (
        db.query(BillingCustomer).filter(BillingCustomer.user_id == user.id).first()
    )
    if billing_customer:
        return billing_customer

    if not stripe_customer_id:
        raise ValueError("stripe_customer_id is required to create BillingCustomer")

    billing_customer = BillingCustomer(
        user_id=user.id,
        stripe_customer_id=stripe_customer_id,
    )
    db.add(billing_customer)
    db.commit()
    db.refresh(billing_customer)
    return billing_customer


def upsert_subscription_from_stripe(
    db: Session,
    user: User,
    stripe_subscription: dict,
) -> Subscription:
    """
    Create or update a Subscription record from a Stripe subscription object.
    """
    sub_id = stripe_subscription["id"]
    status = stripe_subscription.get("status", "unknown")
    cancel_at_period_end = bool(stripe_subscription.get("cancel_at_period_end", False))
    current_period_end_ts = stripe_subscription.get("current_period_end")
    current_period_end: Optional[datetime] = None
    if current_period_end_ts:
        current_period_end = datetime.fromtimestamp(
            current_period_end_ts, tz=timezone.utc
        )

    # Get first price on the subscription
    items = stripe_subscription.get("items", {}).get("data", []) or []
    price_id = None
    if items:
        price = items[0].get("price") or {}
        price_id = price.get("id")
    if not price_id:
        price_id = stripe_subscription.get("plan", {}).get("id", "")

    subscription = (
        db.query(Subscription)
        .filter(Subscription.user_id == user.id)
        .one_or_none()
    )
    if subscription is None:
        subscription = Subscription(
            user_id=user.id,
            stripe_subscription_id=sub_id,
            status=status,
            price_id=price_id or "",
            current_period_end=current_period_end,
            cancel_at_period_end=cancel_at_period_end,
        )
        db.add(subscription)
    else:
        subscription.stripe_subscription_id = sub_id
        subscription.status = status
        subscription.price_id = price_id or subscription.price_id
        subscription.current_period_end = current_period_end
        subscription.cancel_at_period_end = cancel_at_period_end

    db.commit()
    db.refresh(subscription)
    return subscription


def record_billing_event(db: Session, stripe_event_id: str, event_type: str) -> bool:
    """
    Idempotency helper for webhook processing.

    Returns True if the event is new and should be processed,
    False if the event was already seen.
    """
    existing = (
        db.query(BillingEvent)
        .filter(BillingEvent.stripe_event_id == stripe_event_id)
        .one_or_none()
    )
    if existing:
        return False

    event = BillingEvent(stripe_event_id=stripe_event_id, type=event_type)
    db.add(event)
    db.commit()
    return True


def is_premium(db: Session, user_id: int) -> bool:
    """
    Returns True if the user has an active or trialing subscription that
    is not expired.
    """
    subscription = (
        db.query(Subscription)
        .filter(Subscription.user_id == user_id)
        .one_or_none()
    )
    if not subscription:
        return False

    if subscription.status not in ("active", "trialing"):
        return False

    if subscription.current_period_end is None:
        return True

    now = datetime.now(timezone.utc)
    return subscription.current_period_end > now

