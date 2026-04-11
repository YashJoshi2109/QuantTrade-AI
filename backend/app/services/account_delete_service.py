"""
Delete user account: cancel Stripe subscription, remove billing rows, delete user.
"""
from __future__ import annotations

import logging
import stripe
from sqlalchemy.orm import Session

from app.config import settings
from app.models.api_usage import APIUsage
from app.models.billing import BillingCustomer, ConnectedAccount, Subscription
from app.models.user import User

logger = logging.getLogger("account_delete")


def _stripe_ready() -> bool:
    return bool(getattr(settings, "STRIPE_SECRET_KEY", None))


def delete_user_account(db: Session, user: User) -> None:
    user_id = user.id

    if _stripe_ready():
        stripe.api_key = settings.STRIPE_SECRET_KEY
        sub = (
            db.query(Subscription)
            .filter(Subscription.user_id == user_id)
            .one_or_none()
        )
        if sub and sub.stripe_subscription_id:
            try:
                stripe.Subscription.delete(sub.stripe_subscription_id)
            except Exception as exc:
                logger.warning(
                    "Stripe subscription delete failed user_id=%s: %s",
                    user_id,
                    exc,
                )

    db.query(Subscription).filter(Subscription.user_id == user_id).delete()
    db.query(BillingCustomer).filter(BillingCustomer.user_id == user_id).delete()
    db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user_id).delete()
    db.query(APIUsage).filter(APIUsage.user_id == user_id).delete()

    db.delete(user)
    db.commit()
