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
  - Uses billing_events table for idempotency (stripe_event_id), recorded only after
  handlers succeed so Stripe retries are not incorrectly skipped.

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

import logging
import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.config import settings
from app.db.database import get_db
from app.models.billing import BillingCustomer, Subscription
from app.models.user import User
from sqlalchemy.exc import IntegrityError

from app.services.billing_service import (
    billing_event_exists,
    get_or_create_billing_customer,
    mark_billing_event_processed,
    plan_label_for_price_id,
    subscription_entitled,
    upsert_subscription_from_stripe,
)
from app.services.billing_emails import send_subscription_cancel_requested_email


router = APIRouter()
logger = logging.getLogger("billing")

PORTAL_SETUP_HINT = (
    "Enable the Customer portal in Stripe Dashboard: Settings → Billing → Customer portal — "
    "click Save (or create a configuration). Optionally set STRIPE_BILLING_PORTAL_CONFIGURATION_ID "
    "to your portal configuration ID (bpc_...). See https://docs.stripe.com/customer-management/integrate-customer-portal"
)


def _portal_return_url() -> str:
    override = getattr(settings, "BILLING_PORTAL_RETURN_URL", None)
    if override and str(override).strip():
        url = str(override).strip()
        if url.startswith("http://") or url.startswith("https://"):
            return url
        return f"https://{url.lstrip('/')}"
    base = (settings.APP_URL or "https://quanttrade.us").rstrip("/")
    return f"{base}/settings"


def _stripe_client_message(exc: stripe.error.StripeError) -> str:
    um = getattr(exc, "user_message", None)
    if um and str(um).strip():
        return str(um).strip()
    return str(exc).strip() or "Stripe error"


def _stripe_error_corpus(exc: stripe.error.StripeError) -> str:
    """All text Stripe attached to the error (SDK + API JSON). Used for reliable matching."""
    parts: list[str] = [str(exc)]
    um = getattr(exc, "user_message", None)
    if um:
        parts.append(str(um))
    jb = getattr(exc, "json_body", None)
    if isinstance(jb, dict):
        err = jb.get("error")
        if isinstance(err, dict):
            for k in ("message", "type", "code", "param", "doc_url"):
                v = err.get(k)
                if v is not None:
                    parts.append(str(v))
    hb = getattr(exc, "http_body", None)
    if hb:
        parts.append(str(hb))
    return " ".join(parts)


def _is_stripe_environment_mismatch(exc: stripe.error.StripeError) -> bool:
    """
    True when Stripe reports a test vs live key mismatch (local DB has IDs from the other environment).
    """
    msg = _stripe_error_corpus(exc).lower()
    if "test mode" in msg and "live mode" in msg:
        return True
    if "similar object exists" in msg and ("test mode" in msg or "live mode" in msg):
        return True
    return False


def _is_stripe_customer_missing_error(exc: stripe.error.StripeError) -> bool:
    """Stored customer id is invalid in the current Stripe mode (deleted, or test id with live key)."""
    corpus = _stripe_error_corpus(exc).lower()
    if "no such customer" in corpus:
        return True
    if getattr(exc, "code", None) == "resource_missing" and getattr(exc, "param", None) == "customer":
        return True
    return False


def _should_heal_stripe_customer_mapping(exc: stripe.error.StripeError) -> bool:
    return _is_stripe_environment_mismatch(exc) or _is_stripe_customer_missing_error(exc)


def _ensure_stripe_customer_row_valid(
    db: Session, user: User, billing_customer: BillingCustomer, *, context: str
) -> BillingCustomer:
    """
    Confirm the mapped Stripe customer exists for the current API key; if not, heal DB and create a new customer.
    Avoids a failing portal/checkout call when the row points at a test-mode or deleted customer.
    """
    try:
        stripe.Customer.retrieve(billing_customer.stripe_customer_id)
        return billing_customer
    except stripe.error.StripeError as exc:
        if _should_heal_stripe_customer_mapping(exc):
            logger.warning(
                "Stripe customer preflight failed for user_id=%s context=%s; healing: %s",
                user.id,
                context,
                exc,
            )
            _heal_billing_mapping_wrong_stripe_environment(db, user, context=context)
            return _get_stripe_customer_for_user(db, user)
        logger.error(
            "Stripe customer retrieve failed user_id=%s customer=%s: %s",
            user.id,
            billing_customer.stripe_customer_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_stripe_client_message(exc),
        ) from exc


def _heal_billing_mapping_wrong_stripe_environment(
    db: Session, user: User, *, context: str
) -> None:
    """
    Remove billing_customers row and any local subscription row that Stripe rejects
    for the current API key mode, so the next call can create a live customer.
    """
    logger.warning(
        "Stripe test/live mismatch — healing billing mapping for user_id=%s context=%s",
        user.id,
        context,
    )
    db.query(BillingCustomer).filter(BillingCustomer.user_id == user.id).delete(
        synchronize_session=False
    )
    sub = db.query(Subscription).filter(Subscription.user_id == user.id).first()
    if sub:
        try:
            stripe.Subscription.retrieve(sub.stripe_subscription_id)
        except stripe.error.InvalidRequestError as exc:
            err_s = str(exc).lower()
            if "no such subscription" in err_s or _is_stripe_environment_mismatch(exc):
                db.delete(sub)
        except stripe.error.StripeError as exc:
            if _is_stripe_environment_mismatch(exc):
                db.delete(sub)
    db.commit()


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
    is_pro: bool = False
    plan_label: str = "Free"
    status: Optional[str] = None
    price_id: Optional[str] = None
    current_period_end: Optional[datetime] = None
    cancel_at_period_end: Optional[bool] = None


class CancelSubscriptionBody(BaseModel):
    at_period_end: bool = Field(
        default=True,
        description="If true, cancel at end of billing period; if false, end immediately",
    )


def _validate_recurring_subscription_price(price_id: str) -> None:
    """
    Subscription Checkout requires recurring prices. One-time prices fail at Stripe
    with a vague error if misconfigured in STRIPE_PRICE_PLUS_*.
    """
    try:
        price = stripe.Price.retrieve(price_id)
    except stripe.error.StripeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid or inaccessible Stripe price: {exc}",
        ) from exc
    if price.get("type") != "recurring":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Configured Stripe price is not recurring. Subscription checkout "
                "needs a recurring monthly/yearly price, not a one-time price. "
                "Update STRIPE_PRICE_PLUS_MONTHLY / STRIPE_PRICE_PLUS_YEARLY to the "
                "recurring price IDs from the Stripe Dashboard."
            ),
        )


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
    try:
        customer = stripe.Customer.create(
            email=user.email,
            name=user.full_name or user.username,
            metadata={"user_id": str(user.id)},
        )
    except stripe.error.AuthenticationError:
        logger.error("Stripe authentication failed while creating customer for user_id=%s", user.id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing is temporarily unavailable (invalid Stripe configuration)",
        )
    except stripe.error.StripeError as exc:
        logger.error("Stripe error while creating customer for user_id=%s: %s", user.id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to create billing customer",
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
    _validate_recurring_subscription_price(price_id)
    billing_customer = _get_stripe_customer_for_user(db, user)
    billing_customer = _ensure_stripe_customer_row_valid(
        db, user, billing_customer, context="checkout_session_preflight"
    )

    for attempt in range(2):
        try:
            session = stripe.checkout.Session.create(
                mode="subscription",
                customer=billing_customer.stripe_customer_id,
                client_reference_id=str(user.id),
                line_items=[{"price": price_id, "quantity": 1}],
                success_url=f"{settings.APP_URL}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{settings.APP_URL}/billing/cancel",
            )
            return CheckoutSessionResponse(url=session["url"])
        except stripe.error.AuthenticationError:
            logger.error(
                "Stripe authentication failed while creating checkout for user_id=%s", user.id
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Billing is temporarily unavailable (invalid Stripe configuration)",
            )
        except stripe.error.StripeError as exc:
            if attempt == 0 and _should_heal_stripe_customer_mapping(exc):
                _heal_billing_mapping_wrong_stripe_environment(
                    db, user, context="checkout_session"
                )
                billing_customer = _get_stripe_customer_for_user(db, user)
                billing_customer = _ensure_stripe_customer_row_valid(
                    db, user, billing_customer, context="checkout_session_retry"
                )
                continue
            logger.error("Stripe Checkout error for user_id=%s: %s", user.id, exc)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Stripe Checkout error: {str(exc)}",
            ) from exc


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
    except stripe.error.AuthenticationError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing is temporarily unavailable (invalid Stripe configuration)",
        )
    except stripe.error.StripeError:
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
        return SubscriptionStatusResponse(
            has_active=False,
            is_pro=False,
            plan_label="Free",
        )

    entitled = subscription_entitled(sub)

    return SubscriptionStatusResponse(
        has_active=entitled,
        is_pro=entitled,
        plan_label=plan_label_for_price_id(sub.price_id) if entitled else "Free",
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
    billing_customer = _ensure_stripe_customer_row_valid(
        db, user, billing_customer, context="billing_portal_preflight"
    )

    return_url = _portal_return_url()
    if return_url.startswith("http://") and "localhost" not in return_url.lower():
        logger.warning(
            "Billing portal return_url uses http:// for a non-local host; Stripe may reject it: %s",
            return_url,
        )

    portal_kwargs: Dict[str, Any] = {
        "customer": billing_customer.stripe_customer_id,
        "return_url": return_url,
    }
    cfg = getattr(settings, "STRIPE_BILLING_PORTAL_CONFIGURATION_ID", None)
    if cfg and str(cfg).strip():
        portal_kwargs["configuration"] = str(cfg).strip()

    for attempt in range(2):
        try:
            session = stripe.billing_portal.Session.create(**portal_kwargs)
            return PortalSessionResponse(url=session["url"])
        except stripe.error.AuthenticationError:
            logger.error(
                "Stripe authentication failed while creating billing portal for user_id=%s",
                user.id,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Billing is temporarily unavailable (invalid Stripe configuration)",
            )
        except stripe.error.StripeError as exc:
            if attempt == 0 and _should_heal_stripe_customer_mapping(exc):
                _heal_billing_mapping_wrong_stripe_environment(
                    db, user, context="billing_portal"
                )
                billing_customer = _get_stripe_customer_for_user(db, user)
                billing_customer = _ensure_stripe_customer_row_valid(
                    db, user, billing_customer, context="billing_portal_retry"
                )
                portal_kwargs["customer"] = billing_customer.stripe_customer_id
                continue
            msg = _stripe_client_message(exc)
            code = getattr(exc, "code", None)
            param = getattr(exc, "param", None)
            logger.error(
                "Stripe portal error user_id=%s customer=%s code=%s: %s",
                user.id,
                billing_customer.stripe_customer_id,
                code,
                exc,
                exc_info=True,
            )
            lower = msg.lower()
            customer_gone = _is_stripe_customer_missing_error(
                exc
            ) or _is_stripe_environment_mismatch(exc)
            needs_portal_setup = not customer_gone and (
                any(
                    x in lower
                    for x in (
                        "portal",
                        "configuration",
                        "customer portal",
                        "billing portal",
                        "no default",
                    )
                )
                or (code == "resource_missing" and param != "customer")
            )
            detail = msg
            if needs_portal_setup:
                detail = f"{msg} {PORTAL_SETUP_HINT}"
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=detail,
            ) from exc


@router.post(
    "/cancel-subscription",
    status_code=status.HTTP_200_OK,
)
async def cancel_subscription(
    body: CancelSubscriptionBody,
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Cancel the current Stripe subscription (default: at period end).
    Sends a confirmation email via Brevo with a feedback link.
    Local DB state is updated on the next Stripe webhook.
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

    sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    if not sub or not sub.stripe_subscription_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active subscription to cancel",
        )

    if not subscription_entitled(sub):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subscription is not in a cancellable state",
        )

    try:
        if body.at_period_end:
            stripe.Subscription.modify(
                sub.stripe_subscription_id,
                cancel_at_period_end=True,
            )
        else:
            stripe.Subscription.delete(sub.stripe_subscription_id)
    except stripe.error.StripeError as exc:
        logger.error("Stripe cancel error user_id=%s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Stripe could not cancel subscription: {exc}",
        )

    access_until = None
    if sub.current_period_end:
        access_until = sub.current_period_end.strftime("%b %d, %Y")

    send_subscription_cancel_requested_email(
        user.email,
        plan_label=plan_label_for_price_id(sub.price_id),
        access_until=access_until,
        at_period_end=body.at_period_end,
    )

    return {
        "ok": True,
        "at_period_end": body.at_period_end,
        "message": "Cancellation processed. Check your email for confirmation.",
    }


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

    if billing_event_exists(db, event_id):
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

    try:
        mark_billing_event_processed(db, event_id, event_type)
    except IntegrityError:
        # Concurrent duplicate delivery finished first
        db.rollback()

    return {"received": True}

