"""
Transactional email: Brevo (primary) with optional Resend fallback.

send_email_sync() returns (success, error_detail) for OTP flows.
When both BREVO_API_KEY and RESEND_API_KEY are set, delete-account OTP uses
send_redundant_transactional_email_sync() so two independent paths can deliver the same code.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional, Tuple

import httpx

from app.config import settings

logger = logging.getLogger("email_service")

BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email"
RESEND_SEND_URL = "https://api.resend.com/emails"


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


def _resend_from_header() -> str:
    """Resend `from` must be a verified domain or Resend's onboarding address."""
    raw = (getattr(settings, "RESEND_FROM_EMAIL", None) or "").strip()
    if raw:
        return raw
    return "QuantTrade AI <onboarding@resend.dev>"


def _truncate_body(text: str, max_len: int = 280) -> str:
    t = (text or "").replace("\n", " ").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 3] + "..."


def _parse_json_id(data: Any) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    return data.get("messageId") or data.get("id")


def _send_brevo_sync(
    to: str,
    subject: str,
    html: str,
    text_plain: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> Tuple[bool, str]:
    brevo_key = _strip_key(getattr(settings, "BREVO_API_KEY", None))
    if not brevo_key:
        return False, "Brevo not configured"

    brevo_sender = _brevo_sender_dict()
    payload: dict[str, Any] = {
        "sender": brevo_sender,
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
    }
    if text_plain:
        payload["textContent"] = text_plain
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
            mid = None
            try:
                mid = _parse_json_id(r.json())
            except Exception:
                pass
            logger.info("Email sent via Brevo to %s messageId=%s", to, mid or "n/a")
            return True, ""
        msg = _truncate_body(r.text)
        detail = f"Brevo HTTP {r.status_code}: {msg}. Confirm BREVO_FROM_EMAIL is verified in Brevo."
        logger.warning("Brevo failed: %s", detail)
        return False, detail
    except Exception as exc:
        logger.warning("Brevo exception: %s", exc)
        return False, f"Brevo error: {exc}"


def _send_resend_sync(
    to: str,
    subject: str,
    html: str,
    text_plain: Optional[str] = None,
) -> Tuple[bool, str]:
    resend_key = _strip_key(getattr(settings, "RESEND_API_KEY", None))
    if not resend_key:
        return False, "Resend not configured"

    body: dict[str, Any] = {
        "from": _resend_from_header(),
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text_plain:
        body["text"] = text_plain

    try:
        r = httpx.post(
            RESEND_SEND_URL,
            json=body,
            headers={
                "Authorization": f"Bearer {resend_key}",
                "Content-Type": "application/json",
            },
            timeout=15.0,
        )
        if r.status_code in (200, 201):
            mid = None
            try:
                mid = _parse_json_id(r.json())
            except Exception:
                pass
            logger.info("Email sent via Resend to %s id=%s", to, mid or "n/a")
            return True, ""
        msg = _truncate_body(r.text)
        detail = f"Resend HTTP {r.status_code}: {msg}. Verify RESEND_FROM_EMAIL domain in Resend."
        logger.warning("Resend failed: %s", detail)
        return False, detail
    except Exception as exc:
        logger.warning("Resend exception: %s", exc)
        return False, f"Resend error: {exc}"


def send_email_sync(
    to: str,
    subject: str,
    html: str,
    *,
    text_plain: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Try Brevo first, then Resend. Succeeds on first provider that accepts the message.
    """
    errors: list[str] = []
    if _strip_key(getattr(settings, "BREVO_API_KEY", None)):
        ok, err = _send_brevo_sync(to, subject, html, text_plain, reply_to)
        if ok:
            return True, ""
        errors.append(err)
    if _strip_key(getattr(settings, "RESEND_API_KEY", None)):
        ok, err = _send_resend_sync(to, subject, html, text_plain)
        if ok:
            return True, ""
        errors.append(err)
    if not errors:
        return (
            False,
            "No email provider configured (set BREVO_API_KEY and/or RESEND_API_KEY).",
        )
    return False, "; ".join(errors)


def send_redundant_transactional_email_sync(
    to: str,
    subject: str,
    html: str,
    *,
    text_plain: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    When both Brevo and Resend are configured, send through both in parallel (same content).
    Succeeds if at least one provider accepts — improves delivery when one path drops mail.
    With only one provider configured, behaves like send_email_sync.
    """
    brevo_on = bool(_strip_key(getattr(settings, "BREVO_API_KEY", None)))
    resend_on = bool(_strip_key(getattr(settings, "RESEND_API_KEY", None)))
    if not brevo_on and not resend_on:
        return (
            False,
            "No email provider configured (set BREVO_API_KEY and/or RESEND_API_KEY).",
        )
    if not (brevo_on and resend_on):
        return send_email_sync(to, subject, html, text_plain=text_plain, reply_to=reply_to)

    b_ok, b_err = _send_brevo_sync(to, subject, html, text_plain, reply_to)
    r_ok, r_err = _send_resend_sync(to, subject, html, text_plain)
    logger.info(
        "Redundant transactional send to %s: brevo_ok=%s resend_ok=%s",
        to,
        b_ok,
        r_ok,
    )
    if b_ok or r_ok:
        return True, ""
    return False, f"{b_err}; {r_err}"


async def send_email(
    to: str,
    subject: str,
    html: str,
    *,
    text_plain: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> bool:
    """Async wrapper; returns True on success."""
    ok, _ = await asyncio.to_thread(
        send_email_sync,
        to,
        subject,
        html,
        text_plain=text_plain,
        reply_to=reply_to,
    )
    return ok
