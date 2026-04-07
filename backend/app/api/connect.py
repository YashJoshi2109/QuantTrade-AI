"""
Stripe Connect integration endpoints (live-ready sample).

This module uses StripeClient for all Stripe requests, including:
- V2 connected account creation + onboarding links
- Product creation/listing on connected accounts
- Direct-charge Checkout with application fee
- Platform-level subscription checkout + billing portal for connected accounts
- Thin event and snapshot webhook handlers
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from stripe import StripeClient
import stripe

from app.api.auth import require_auth
from app.config import settings
from app.db.database import get_db
from app.models.billing import ConnectedAccount
from app.models.user import User

logger = logging.getLogger("connect")
router = APIRouter()


def _stripe_client() -> StripeClient:
    """
    Create a Stripe client from STRIPE_SECRET_KEY.
    Raises a helpful error if key is missing.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="STRIPE_SECRET_KEY is missing. Set it in backend/.env before using payments.",
        )
    return StripeClient(settings.STRIPE_SECRET_KEY)


def _coerce_response_dict(obj: Any) -> Dict[str, Any]:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    if hasattr(obj, "__dict__"):
        return dict(obj.__dict__)
    return {}


def _raw_v2(client: StripeClient, method: str, path: str, **params) -> Dict[str, Any]:
    """
    Use StripeClient.raw_request for V2 resources not yet exposed as typed services.
    """
    resp = client.raw_request(method, path, **params)
    # raw_request in recent SDK returns StripeResponse with json payload in body.
    body = getattr(resp, "body", None)
    if isinstance(body, (bytes, bytearray)):
        body = body.decode("utf-8", errors="ignore")
    if isinstance(body, str) and body.strip():
        try:
            return json.loads(body)
        except Exception:
            return {}
    data = getattr(resp, "data", None)
    if isinstance(data, dict):
        return data
    return {}


def _upsert_connected_account(
    db: Session,
    user_id: int,
    account_id: str,
    onboarding_complete: Optional[bool] = None,
    card_payments_status: Optional[str] = None,
    requirements_status: Optional[str] = None,
) -> ConnectedAccount:
    row = db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user_id).first()
    if not row:
        row = ConnectedAccount(user_id=user_id, stripe_account_id=account_id)
        db.add(row)
    row.stripe_account_id = account_id
    if onboarding_complete is not None:
        row.onboarding_complete = onboarding_complete
    if card_payments_status is not None:
        row.card_payments_status = card_payments_status
    if requirements_status is not None:
        row.requirements_status = requirements_status
    db.commit()
    db.refresh(row)
    return row


class ConnectedAccountCreateRequest(BaseModel):
    display_name: Optional[str] = None
    contact_email: Optional[str] = None


class ProductCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    price_in_cents: int = Field(gt=0)
    currency: str = "usd"


class StorefrontCheckoutRequest(BaseModel):
    account_id: str
    product_name: str
    amount_cents: int = Field(gt=0)
    currency: str = "usd"
    quantity: int = Field(default=1, gt=0)


class AccountSubscriptionCheckoutRequest(BaseModel):
    connected_account_id: str
    price_id: Optional[str] = None


@router.post("/account")
def create_connected_account(
    req: ConnectedAccountCreateRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """
    Create a connected account using V2 accounts API with required properties.
    """
    existing = db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user.id).first()
    if existing:
        return {"connected_account_id": existing.stripe_account_id, "already_exists": True}

    display_name = (req.display_name or user.full_name or user.username or "QuantTrade Seller").strip()
    contact_email = (req.contact_email or user.email).strip()
    if not contact_email:
        raise HTTPException(status_code=400, detail="User email required to create connected account")

    payload = {
        "display_name": display_name,
        "contact_email": contact_email,
        "identity": {"country": "us"},
        "dashboard": "full",
        "defaults": {
            "responsibilities": {
                "fees_collector": "stripe",
                "losses_collector": "stripe",
            }
        },
        "configuration": {
            "customer": {},
            "merchant": {
                "capabilities": {
                    "card_payments": {
                        "requested": True,
                    }
                }
            },
        },
    }

    try:
        client = _stripe_client()
        account = _raw_v2(client, "post", "/v2/core/accounts", params=payload)
        account_id = account.get("id")
        if not account_id:
            raise HTTPException(status_code=502, detail="Stripe did not return a connected account ID")
        _upsert_connected_account(db, user.id, account_id)
        return {"connected_account_id": account_id}
    except HTTPException:
        raise
    except stripe.error.StripeError as exc:
        logger.error("Stripe create account error: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create connected account")


@router.get("/account/status")
def get_connected_account_status(
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    row = db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user.id).first()
    if not row:
        return {"has_account": False}
    try:
        client = _stripe_client()
        account = _raw_v2(
            client,
            "get",
            f"/v2/core/accounts/{row.stripe_account_id}",
            include=["configuration.merchant", "requirements"],
        )
        card_status = (
            account.get("configuration", {})
            .get("merchant", {})
            .get("capabilities", {})
            .get("card_payments", {})
            .get("status")
        )
        requirements_status = (
            account.get("requirements", {})
            .get("summary", {})
            .get("minimum_deadline", {})
            .get("status")
        )
        onboarding_complete = requirements_status not in ("currently_due", "past_due")
        _upsert_connected_account(
            db,
            user.id,
            row.stripe_account_id,
            onboarding_complete=onboarding_complete,
            card_payments_status=card_status,
            requirements_status=requirements_status,
        )
        return {
            "has_account": True,
            "connected_account_id": row.stripe_account_id,
            "ready_to_process_payments": card_status == "active",
            "requirements_status": requirements_status,
            "onboarding_complete": onboarding_complete,
            "account": account,
        }
    except HTTPException:
        raise
    except stripe.error.StripeError as exc:
        logger.error("Stripe status fetch error: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to fetch account status")


@router.post("/account/onboarding-link")
def create_onboarding_link(
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    row = db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="No connected account found. Create one first.")
    try:
        client = _stripe_client()
        link = _raw_v2(
            client,
            "post",
            "/v2/core/account_links",
            params={
                "account": row.stripe_account_id,
                "use_case": {
                    "type": "account_onboarding",
                    "account_onboarding": {
                        "configurations": ["merchant", "customer"],
                        "refresh_url": f"{settings.APP_URL}/connect",
                        "return_url": f"{settings.APP_URL}/connect?accountId={row.stripe_account_id}",
                    },
                },
            },
        )
        return {"url": link.get("url"), "connected_account_id": row.stripe_account_id}
    except stripe.error.StripeError as exc:
        logger.error("Stripe onboarding link error: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create onboarding link")


@router.post("/products")
def create_product_on_connected_account(
    req: ProductCreateRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    row = db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="No connected account found. Create one first.")
    client = _stripe_client()
    try:
        product = client.products.create(
            {
                "name": req.name,
                "description": req.description,
                "default_price_data": {
                    "unit_amount": req.price_in_cents,
                    "currency": req.currency.lower(),
                },
            },
            {"stripe_account": row.stripe_account_id},
        )
        p = _coerce_response_dict(product)
        return {"product": p}
    except stripe.error.StripeError as exc:
        logger.error("Stripe product create error: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create product")


@router.get("/storefront/{account_id}/products")
def list_connected_account_products(account_id: str):
    """
    NOTE: demo uses account ID in URL. In production, use a public seller slug instead.
    """
    client = _stripe_client()
    try:
        products = client.products.list(
            {"limit": 20, "active": True, "expand": ["data.default_price"]},
            {"stripe_account": account_id},
        )
        return {"products": _coerce_response_dict(products).get("data", [])}
    except stripe.error.StripeError as exc:
        logger.error("Stripe product list error: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to list products")


@router.post("/storefront/checkout")
def create_storefront_checkout(req: StorefrontCheckoutRequest):
    client = _stripe_client()
    try:
        session = client.checkout.sessions.create(
            {
                "line_items": [
                    {
                        "price_data": {
                            "currency": req.currency.lower(),
                            "product_data": {"name": req.product_name},
                            "unit_amount": req.amount_cents,
                        },
                        "quantity": req.quantity,
                    }
                ],
                "payment_intent_data": {
                    "application_fee_amount": 123,
                },
                "mode": "payment",
                "success_url": f"{settings.APP_URL}/connect?success=1&session_id={{CHECKOUT_SESSION_ID}}",
                "cancel_url": f"{settings.APP_URL}/connect?cancel=1",
            },
            {"stripe_account": req.account_id},
        )
        s = _coerce_response_dict(session)
        return {"url": s.get("url")}
    except stripe.error.StripeError as exc:
        logger.error("Stripe checkout create error: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create checkout session")


@router.post("/subscription/checkout")
def create_connected_account_subscription_checkout(
    req: AccountSubscriptionCheckoutRequest,
):
    """
    Charge subscription at platform level using connected account as customer_account.
    """
    if not (req.price_id or settings.STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID):
        raise HTTPException(
            status_code=400,
            detail="Missing price_id. Set STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID or pass price_id.",
        )
    price_id = req.price_id or settings.STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID
    client = _stripe_client()
    try:
        session = client.checkout.sessions.create(
            {
                "customer_account": req.connected_account_id,
                "mode": "subscription",
                "line_items": [{"price": price_id, "quantity": 1}],
                "success_url": f"{settings.APP_URL}/connect?subscription=success&session_id={{CHECKOUT_SESSION_ID}}",
                "cancel_url": f"{settings.APP_URL}/connect?subscription=cancel",
            }
        )
        s = _coerce_response_dict(session)
        return {"url": s.get("url")}
    except stripe.error.StripeError as exc:
        logger.error("Stripe subscription checkout error: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create subscription checkout")


@router.post("/subscription/portal")
def create_connected_account_billing_portal(
    connected_account_id: str,
):
    client = _stripe_client()
    try:
        session = client.billing_portal.sessions.create(
            {
                "customer_account": connected_account_id,
                "return_url": f"{settings.APP_URL}/connect",
            }
        )
        s = _coerce_response_dict(session)
        return {"url": s.get("url")}
    except stripe.error.StripeError as exc:
        logger.error("Stripe billing portal error: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create billing portal session")


@router.post("/webhooks/connect-thin", include_in_schema=False)
async def stripe_connect_thin_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(default=None, alias="Stripe-Signature"),
):
    if not settings.STRIPE_CONNECT_THIN_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="STRIPE_CONNECT_THIN_WEBHOOK_SECRET is not configured")
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")

    payload = await request.body()
    client = _stripe_client()
    try:
        thin_event = client.parse_thin_event(payload, stripe_signature, settings.STRIPE_CONNECT_THIN_WEBHOOK_SECRET)
        event_id = getattr(thin_event, "id", None)
        if not event_id:
            return {"received": True}
        full_event = _raw_v2(client, "get", f"/v2/core/events/{event_id}")
        event_type = full_event.get("type") or getattr(thin_event, "type", "unknown")
        # Add app-specific processing here (DB updates, notifications, etc.)
        return {"received": True, "event_type": event_type}
    except Exception as exc:
        logger.error("Thin webhook parse failure: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid thin webhook payload")


@router.post("/webhooks/billing", include_in_schema=False)
async def stripe_billing_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(default=None, alias="Stripe-Signature"),
):
    """
    Snapshot webhook handler for subscription lifecycle and billing portal events.
    """
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="STRIPE_WEBHOOK_SECRET is not configured")
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")

    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(payload=payload, sig_header=stripe_signature, secret=settings.STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    event_type = event.get("type", "")
    data_obj = event.get("data", {}).get("object", {})
    # TODO: Persist subscription/customer/payment method updates in DB.
    logger.info("Stripe billing webhook event=%s object_id=%s", event_type, data_obj.get("id"))
    return {"received": True, "event_type": event_type}
