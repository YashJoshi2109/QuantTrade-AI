"""
Email verification service using Rapid Email Verifier API
https://rapid-email-verifier.fly.dev/

When DEBUG=True and the verifier is unreachable, we fall back to basic syntax
so local dev is not blocked if the third-party service is down.
"""
import re
import httpx
from typing import Optional
from dataclasses import dataclass

from app.config import settings

RAPID_EMAIL_VERIFIER_URL = "https://rapid-email-verifier.fly.dev"

_LOOSE_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _loose_email_syntax_ok(email: str) -> bool:
    return bool(_LOOSE_EMAIL.match((email or "").strip()))


@dataclass
class EmailValidationResult:
    valid: bool
    status: str  # VALID, INVALID_FORMAT, INVALID_DOMAIN, DISPOSABLE, PROBABLY_VALID
    syntax_valid: bool
    domain_exists: bool
    mx_records: bool
    is_disposable: bool
    is_role_based: bool
    message: str
    typo_suggestion: Optional[str] = None
    alias_of: Optional[str] = None


async def validate_email(email: str) -> EmailValidationResult:
    """
    Validate email using Rapid Email Verifier API.
    Returns validation result with detailed status.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{RAPID_EMAIL_VERIFIER_URL}/api/validate",
                params={"email": email},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as e:
        if settings.DEBUG and _loose_email_syntax_ok(email):
            return EmailValidationResult(
                valid=True,
                status="DEBUG_VERIFIER_SKIPPED",
                syntax_valid=True,
                domain_exists=True,
                mx_records=True,
                is_disposable=False,
                is_role_based=False,
                message="Debug mode: email verifier unreachable; using basic syntax check only.",
            )
        return EmailValidationResult(
            valid=False,
            status="ERROR",
            syntax_valid=False,
            domain_exists=False,
            mx_records=False,
            is_disposable=False,
            is_role_based=False,
            message=f"Email validation service unavailable: {str(e)}",
        )
    except Exception as e:
        if settings.DEBUG and _loose_email_syntax_ok(email):
            return EmailValidationResult(
                valid=True,
                status="DEBUG_VERIFIER_SKIPPED",
                syntax_valid=True,
                domain_exists=True,
                mx_records=True,
                is_disposable=False,
                is_role_based=False,
                message="Debug mode: email verifier error; using basic syntax check only.",
            )
        return EmailValidationResult(
            valid=False,
            status="ERROR",
            syntax_valid=False,
            domain_exists=False,
            mx_records=False,
            is_disposable=False,
            is_role_based=False,
            message=str(e),
        )

    validations = data.get("validations", {})
    status = data.get("status", "UNKNOWN")

    # Accept VALID and PROBABLY_VALID (e.g. role-based emails)
    valid = status in ("VALID", "PROBABLY_VALID")
    if status == "DISPOSABLE":
        valid = False

    return EmailValidationResult(
        valid=valid,
        status=status,
        syntax_valid=validations.get("syntax", False),
        domain_exists=validations.get("domain_exists", False),
        mx_records=validations.get("mx_records", False),
        is_disposable=validations.get("is_disposable", False),
        is_role_based=validations.get("is_role_based", False),
        message=_status_to_message(status, validations),
        typo_suggestion=data.get("typo_suggestion"),
        alias_of=data.get("aliasOf"),
    )


def _status_to_message(status: str, validations: dict) -> str:
    if status == "VALID":
        return "Email is valid"
    if status == "PROBABLY_VALID":
        return "Email appears valid (role-based address)"
    if status == "INVALID_FORMAT":
        return "Invalid email format"
    if status == "INVALID_DOMAIN":
        return "Email domain does not exist"
    if status == "DISPOSABLE":
        return "Disposable/temporary email addresses are not allowed"
    if status == "UNKNOWN":
        return "Unable to verify email"
    return "Email validation failed"
