"""
One-time welcome email after sign-in with QuantTrade Pro discount code (Brevo).

Sends at most once per user (welcome_promo_email_sent_at on users).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.config import settings

logger = logging.getLogger(__name__)


def _build_welcome_promo_html(
    email: str,
    promo_code: str,
    amount_label: str,
    pricing_url: str,
) -> str:
    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your QuantTrade welcome</title>
  <style>
    body {{ margin: 0; padding: 0; background: #060B12; font-family: -apple-system, 'Segoe UI', sans-serif; }}
    .wrap {{ max-width: 560px; margin: 0 auto; padding: 36px 20px; }}
    .card {{ background: #0D1828; border: 1px solid rgba(0,212,255,0.2); border-radius: 16px; overflow: hidden; }}
    .head {{ padding: 28px 28px 20px; border-bottom: 1px solid rgba(71,85,105,0.35); }}
    .brand {{ color: #00D4FF; font-size: 17px; font-weight: 700; }}
    h1 {{ margin: 12px 0 0; color: #F8FAFC; font-size: 22px; font-weight: 600; }}
    .body {{ padding: 28px; color: #CBD5E1; font-size: 15px; line-height: 1.65; }}
    .code {{
      display: inline-block; margin: 18px 0; padding: 14px 22px;
      background: rgba(0,212,255,0.08); border: 1px dashed rgba(0,212,255,0.45);
      border-radius: 10px; font-family: ui-monospace, monospace; font-size: 18px;
      font-weight: 700; letter-spacing: 0.12em; color: #E0F2FE;
    }}
    .cta {{
      display: inline-block; margin-top: 8px; padding: 12px 24px; background: linear-gradient(90deg, #06b6d4, #0ea5e9);
      color: #020617; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px;
    }}
    .fine {{ margin-top: 24px; font-size: 12px; color: #64748B; line-height: 1.5; }}
    .foot {{ padding: 20px 28px; border-top: 1px solid rgba(71,85,105,0.25); font-size: 12px; color: #475569; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <div class="brand">QuantTrade AI</div>
        <h1>Thanks for signing in</h1>
      </div>
      <div class="body">
        <p>Hi — quick note from us.</p>
        <p>
          If you decide to go Pro, here&apos;s a welcome discount: <strong style="color:#e2e8f0;">{amount_label} off</strong>
          your subscription (monthly or yearly). Enter this at checkout:
        </p>
        <div class="code">{promo_code}</div>
        <p style="margin-bottom:8px;">
          <a class="cta" href="{pricing_url}">View plans &amp; subscribe</a>
        </p>
        <p class="fine">
          The code is subject to Stripe&apos;s limits (e.g. max redemptions). If it doesn&apos;t apply, check spelling or ask
          <a href="mailto:quanttrade.us@icloud.com" style="color:#38bdf8;">quanttrade.us@icloud.com</a>.
        </p>
      </div>
      <div class="foot">
        You signed in as {email}. This is a one-time message from QuantTrade AI.
      </div>
    </div>
  </div>
</body>
</html>
"""


async def send_welcome_promo_email(to_email: str) -> bool:
    """Send welcome promo email. Returns True if Brevo accepted the send."""
    brevo_key = getattr(settings, "BREVO_API_KEY", None)
    if not brevo_key:
        logger.warning("BREVO_API_KEY not set — skipping welcome promo email")
        return False

    promo = (settings.STRIPE_WELCOME_PROMO_CUSTOMER_CODE or "QUANTTRADE").strip()
    amount = (settings.STRIPE_WELCOME_PROMO_AMOUNT_LABEL or "$15").strip()
    app_url = (getattr(settings, "APP_URL", "") or "https://quanttrade.us").rstrip("/")
    pricing_url = f"{app_url}/pricing"

    html = _build_welcome_promo_html(to_email, promo, amount, pricing_url)
    subject = f"Your QuantTrade welcome — {amount} off Pro ({promo})"

    try:
        from app.services.email_service import send_email

        return await send_email(to_email, subject, html)
    except Exception as exc:
        logger.error("Welcome promo email failed: %s", exc)
        return False


async def try_send_welcome_promo_email_task(user_id: int) -> None:
    """
    Background task: send welcome promo once, then set welcome_promo_email_sent_at.
    Uses a fresh DB session (safe after login response).
    """
    from app.db.database import SessionLocal
    from app.models.user import User

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return
        if getattr(user, "welcome_promo_email_sent_at", None) is not None:
            return
        ok = await send_welcome_promo_email(user.email)
        if ok:
            user.welcome_promo_email_sent_at = datetime.now(timezone.utc)
            db.commit()
    except Exception as exc:
        logger.warning("welcome_promo task error user_id=%s: %s", user_id, exc)
        db.rollback()
    finally:
        db.close()


def schedule_welcome_promo_email(user_id: int) -> None:
    """Fire-and-forget after successful login / Google sign-in."""
    try:
        asyncio.create_task(try_send_welcome_promo_email_task(user_id))
    except Exception as exc:
        logger.debug("schedule_welcome_promo_email: %s", exc)
