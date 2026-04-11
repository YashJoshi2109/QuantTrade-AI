"""
Cloudflare Turnstile CAPTCHA verification service.

Validates Turnstile tokens on login/register to prevent bot abuse.
Free tier — unlimited verifications.

Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
"""

import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile(token: str, remote_ip: Optional[str] = None) -> bool:
    """
    Verify a Turnstile token with Cloudflare's API.

    Returns True if valid, False if invalid or verification skipped.
    Gracefully degrades: if no secret key configured, allows the request.
    """
    secret_key = getattr(settings, "TURNSTILE_SECRET_KEY", None)
    if not secret_key:
        logger.debug("Turnstile secret key not configured — skipping verification")
        return True

    if not token:
        logger.warning("Empty Turnstile token received")
        return False

    payload = {
        "secret": secret_key,
        "response": token,
    }
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(TURNSTILE_VERIFY_URL, data=payload)
            resp.raise_for_status()
            result = resp.json()

        success = result.get("success", False)
        if not success:
            error_codes = result.get("error-codes", [])
            logger.warning(f"Turnstile verification failed: {error_codes}")

        return success

    except Exception as e:
        logger.error(f"Turnstile API error: {e}")
        # Fail open — don't block users if Cloudflare is down
        return True
