"""
Email verification service using Rapid Email Verifier API
https://rapid-email-verifier.fly.dev/
"""
import httpx
from typing import Optional
from dataclasses import dataclass


RAPID_EMAIL_VERIFIER_URL = "https://rapid-email-verifier.fly.dev"


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
