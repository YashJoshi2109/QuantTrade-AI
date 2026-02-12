"""
Billing API router

Implementation Notes
--------------------
Endpoints:
- POST /api/v1/billing/checkout-session
  - Body: { "price_id": "<stripe_price_id>" } OR { "plan": "plus_monthly" | "plus_yearly" }
  - Auth required (JWT). Derives user_id from token server-side.
  - Ensures Stripe Customer exists, then creates a Checkout Session (mode=subscription).
  - Returns { "url": "<stripe_checkout_url>" } for client-side redirect.

- GET /api/v1/billing/session-status
  - Query: session_id
  - Fetches Checkout Session from Stripe and returns subscription/customer/status snapshot.

- POST /api/v1/billing/portal
  - Auth required.
  - Creates a Stripe Billing Portal session for the user's Stripe customer.
  - Returns { "url": "<stripe_portal_url>" } for client-side redirect.

- POST /api/v1/billing/webhook
  - Stripe webhook endpoint.
  - Verifies signature with STRIPE_WEBHOOK_SECRET using the raw request body.
  - Uses billing_events table for idempotency (stripe_event_id).

Webhook Events Mapping:
- checkout.session.completed
  - Ensure billing_customers entry exists.
  - Fetch Stripe Subscription and upsert subscriptions record.

- invoice.paid
  - Fetch Stripe Subscription by ID from event and upsert subscriptions record
    with status "active" and updated current_period_end.

- invoice.payment_failed
  - Fetch Stripe Subscription and upsert subscriptions record with status "past_due".

- customer.subscription.updated / customer.subscription.deleted
  - Sync status and cancel_at_period_end in subscriptions table.

Important:
- Never trust client for subscription status.
- Stripe is the source of truth; only webhooks update billing state in Neon.
"""

from datetime import datetime
from typing import Any, Dict, Optional

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.config import settings
from app.db.database import get_db
from app.models.billing import BillingCustomer, Subscription
from app.models.user import User
from app.services.billing_service import (
    get_or_create_billing_customer,
    record_billing_event,
    upsert_subscription_from_stripe,
)


router = APIRouter()

if not settings.STRIPE_SECRET_KEY:
    # Stripe will be configured at runtime if keys are provided; otherwise
    # endpoints will raise at call time.
    stripe.api_key = None
else:
    stripe.api_key = settings.STRIPE_SECRET_KEY


class CheckoutSessionRequest(BaseModel):
    price_id: Optional[str] = Field(
        default=None, description="Explicit Stripe Price ID to subscribe to"
    )
    plan: Optional[str] = Field(
        default=None,
        description='Named plan identifier, e.g. "plus_monthly" or "plus_yearly"',
    )


class CheckoutSessionResponse(BaseModel):
    url: str


class PortalSessionResponse(BaseModel):
    url: str


class SessionStatusResponse(BaseModel):
    id: str
    status: Optional[str] = None
    customer_id: Optional[str] = None
    subscription_id: Optional[str] = None
    price_id: Optional[str] = None


class SubscriptionStatusResponse(BaseModel):
    has_active: bool
    status: Optional[str] = None
    price_id: Optional[str] = None
    current_period_end: Optional[datetime] = None
    cancel_at_period_end: Optional[bool] = None


def _resolve_price_id(body: CheckoutSessionRequest) -> str:
    if body.price_id:
        return body.price_id

    if body.plan == "plus_monthly":
        if not settings.STRIPE_PRICE_PLUS_MONTHLY:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Monthly price is not configured on the server",
            )
        return settings.STRIPE_PRICE_PLUS_MONTHLY

    if body.plan == "plus_yearly":
        if not settings.STRIPE_PRICE_PLUS_YEARLY:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Yearly price is not configured on the server",
            )
        return settings.STRIPE_PRICE_PLUS_YEARLY

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Must provide either price_id or a valid plan",
    )


def _get_stripe_customer_for_user(db: Session, user: User) -> BillingCustomer:
    # Existing mapping?
    billing_customer = (
        db.query(BillingCustomer).filter(BillingCustomer.user_id == user.id).first()
    )
    if billing_customer:
        return billing_customer

    if not stripe.api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe is not configured on the server",
        )

    # Create Stripe customer
    customer = stripe.Customer.create(
        email=user.email,
        name=user.full_name or user.username,
        metadata={"user_id": str(user.id)},
    )

    return get_or_create_billing_customer(
        db=db, user=user, stripe_customer_id=customer["id"]
    )


@router.post(
    "/checkout-session",
    response_model=CheckoutSessionResponse,
)
async def create_checkout_session(
    body: CheckoutSessionRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a Stripe Checkout Session for a subscription purchase.
    """
    if not stripe.api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe is not configured on the server",
        )

    user_id = int(current_user["user_id"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    price_id = _resolve_price_id(body)
    billing_customer = _get_stripe_customer_for_user(db, user)

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=billing_customer.stripe_customer_id,
            client_reference_id=str(user.id),
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"{settings.APP_URL}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.APP_URL}/billing/cancel",
        )
    except Exception as e:
        import logging
        logging.getLogger("billing").error("Stripe Checkout error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to create Stripe Checkout session",
        )

    return CheckoutSessionResponse(url=session["url"])


@router.get(
    "/session-status",
    response_model=SessionStatusResponse,
)
async def get_session_status(session_id: str):
    """
    Retrieve a Checkout Session from Stripe and expose a minimal status snapshot.
    """
    if not stripe.api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe is not configured on the server",
        )

    try:
        session = stripe.checkout.Session.retrieve(
            session_id, expand=["subscription", "subscription.items.data.price"]
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Checkout session not found",
        )

    subscription = session.get("subscription")
    subscription_id = None
    price_id: Optional[str] = None
    if isinstance(subscription, dict):
        subscription_id = subscription.get("id")
        items = subscription.get("items", {}).get("data", []) or []
        if items:
            price_obj = items[0].get("price") or {}
            price_id = price_obj.get("id")

    return SessionStatusResponse(
        id=session["id"],
        status=session.get("status"),
        customer_id=session.get("customer"),
        subscription_id=subscription_id,
        price_id=price_id,
    )


@router.get(
    "/subscription",
    response_model=SubscriptionStatusResponse,
)
async def get_subscription_status(
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get current user's subscription status from the local subscriptions table.
    """
    user_id = int(current_user["user_id"])
    sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()

    if not sub:
        return SubscriptionStatusResponse(has_active=False)

    is_active = sub.status in ("active", "trialing", "past_due")

    return SubscriptionStatusResponse(
        has_active=is_active,
        status=sub.status,
        price_id=sub.price_id,
        current_period_end=sub.current_period_end,
        cancel_at_period_end=sub.cancel_at_period_end,
    )


@router.post(
    "/portal",
    response_model=PortalSessionResponse,
)
async def create_billing_portal_session(
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a Stripe Billing Portal session for the current user.
    """
    if not stripe.api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe is not configured on the server",
        )

    user_id = int(current_user["user_id"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    billing_customer = _get_stripe_customer_for_user(db, user)

    try:
        session = stripe.billing_portal.Session.create(
            customer=billing_customer.stripe_customer_id,
            return_url=f"{settings.APP_URL}/settings",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to create Stripe Billing Portal session",
        )

    return PortalSessionResponse(url=session["url"])


@router.post(
    "/webhook",
    status_code=status.HTTP_200_OK,
    include_in_schema=False,
)
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None, alias="Stripe-Signature"),
    db: Session = Depends(get_db),
):
    """
    Stripe webhook endpoint.

    Uses raw body for signature verification and billing_events table for idempotency.
    """
    if not settings.STRIPE_WEBHOOK_SECRET or not settings.STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe webhook is not configured on the server",
        )

    payload = await request.body()
    sig_header = stripe_signature
    if sig_header is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing Stripe-Signature header",
        )

    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=settings.STRIPE_WEBHOOK_SECRET,
        )
    except stripe.error.SignatureVerificationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Stripe webhook signature",
        )
    except ValueError:
        # Invalid payload
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid webhook payload",
        )

    event_id = event["id"]
    event_type = event["type"]

    # Idempotency: skip if we've already processed this event
    should_process = record_billing_event(
        db=db, stripe_event_id=event_id, event_type=event_type
    )
    if not should_process:
        return {"received": True, "idempotent": True}

    data_object = event.get("data", {}).get("object", {})

    # Helper to resolve user by client_reference_id or customer mapping
    def _get_user_for_stripe_customer(
        stripe_customer_id: Optional[str],
    ) -> Optional[User]:
        if not stripe_customer_id:
            return None
        billing_customer = (
            db.query(BillingCustomer)
            .filter(BillingCustomer.stripe_customer_id == stripe_customer_id)
            .one_or_none()
        )
        if not billing_customer:
            return None
        return db.query(User).filter(User.id == billing_customer.user_id).one_or_none()

    # Event handlers
    if event_type == "checkout.session.completed":
        # Subscription checkout completed; use client_reference_id or customer to find user
        client_reference_id = data_object.get("client_reference_id")
        customer_id = data_object.get("customer")
        user: Optional[User] = None

        if client_reference_id:
            try:
                user_id = int(client_reference_id)
                user = db.query(User).filter(User.id == user_id).one_or_none()
            except (ValueError, TypeError):
                user = None

        if not user and customer_id:
            user = _get_user_for_stripe_customer(customer_id)

        if user and customer_id:
            # Ensure billing customer record exists
            _ = get_or_create_billing_customer(
                db=db, user=user, stripe_customer_id=customer_id
            )

            # Load subscription details from Stripe and upsert
            subscription_id = data_object.get("subscription")
            if subscription_id:
                stripe_subscription = stripe.Subscription.retrieve(subscription_id)
                upsert_subscription_from_stripe(
                    db=db, user=user, stripe_subscription=stripe_subscription
                )

    elif event_type in ("invoice.paid", "invoice.payment_failed"):
        invoice = data_object
        subscription_id = invoice.get("subscription")
        customer_id = invoice.get("customer")
        user = _get_user_for_stripe_customer(customer_id)
        if user and subscription_id:
            stripe_subscription = stripe.Subscription.retrieve(subscription_id)
            # For payment_failed, subscription status in Stripe will usually be "past_due"
            upsert_subscription_from_stripe(
                db=db, user=user, stripe_subscription=stripe_subscription
            )

    elif event_type in (
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        subscription_obj = data_object
        customer_id = subscription_obj.get("customer")
        user = _get_user_for_stripe_customer(customer_id)
        if user:
            upsert_subscription_from_stripe(
                db=db, user=user, stripe_subscription=subscription_obj
            )

    # Acknowledge receipt
    return {"received": True}

