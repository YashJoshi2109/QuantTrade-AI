"""
Transactional email via Brevo (Sendinblue) API only.

send_email_sync() returns (success, error_detail) for OTP flows.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional, Tuple

import httpx

from app.config import settings

logger = logging.getLogger("email_service")

BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email"


def _strip_key(key: Optional[str]) -> Optional[str]:
    if key is None:
        return None
    s = key.strip()
    return s if s else None


def _brevo_sender_dict() -> dict:
    """Sender for Brevo — must be a verified sender in Brevo (SMTP & API)."""
    raw = (getattr(settings, "BREVO_FROM_EMAIL", None) or "").strip()
    if not raw:
        raw = "QuantTrade AI <noreply@quanttrade.us>"
    if "<" in raw and raw.endswith(">"):
        name, addr = raw.split("<", 1)
        return {"name": name.strip(), "email": addr.rstrip(">").strip()}
    return {"name": "QuantTrade AI", "email": raw.strip()}


def _truncate_body(text: str, max_len: int = 280) -> str:
    t = (text or "").replace("\n", " ").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 3] + "..."


def _send_transactional_email_sync(
    to: str,
    subject: str,
    html: str,
    reply_to: Optional[str] = None,
) -> Tuple[bool, str]:
    brevo_key = _strip_key(getattr(settings, "BREVO_API_KEY", None))

    if not brevo_key:
        return (
            False,
            "BREVO_API_KEY is not set. Add it to backend/.env (local) or GitHub Secrets / server .env (production).",
        )

    brevo_sender = _brevo_sender_dict()
    payload: dict = {
        "sender": brevo_sender,
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
    }
    if reply_to:
        payload["replyTo"] = {"email": reply_to}

    try:
        r = httpx.post(
            BREVO_SEND_URL,
            json=payload,
            headers={
                "api-key": brevo_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=15.0,
        )
        if r.status_code in (200, 201):
            logger.info("Email sent via Brevo to %s", to)
            return True, ""
        msg = _truncate_body(r.text)
        detail = f"Brevo HTTP {r.status_code}: {msg}. Confirm BREVO_FROM_EMAIL is verified in Brevo."
        logger.warning("Brevo failed: %s", detail)
        return False, detail
    except Exception as exc:
        logger.warning("Brevo exception: %s", exc)
        return False, f"Brevo error: {exc}"


async def send_email(
    to: str,
    subject: str,
    html: str,
    *,
    reply_to: Optional[str] = None,
) -> bool:
    """Async wrapper; returns True on success."""
    ok, _ = await asyncio.to_thread(_send_transactional_email_sync, to, subject, html, reply_to)
    return ok


def send_email_sync(to: str, subject: str, html: str) -> Tuple[bool, str]:
    """Synchronous send for OTP thread pool."""
    return _send_transactional_email_sync(to, subject, html, None)
