"""
Login notification service: sends a security alert email whenever a user signs in,
containing their IP address, device info, and timestamp.

Uses the existing Resend API key configured in .env
OWASP A09: Security Logging — every authentication event is communicated to user
"""
import logging
from datetime import datetime, timezone
from typing import Optional
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

RESEND_SEND_URL = "https://api.resend.com/emails"


def _get_device_label(user_agent: str) -> str:
    """Extract a human-readable device label from User-Agent string."""
    ua = user_agent.lower()
    browser = "Unknown Browser"
    os_label = "Unknown OS"

    if "chrome" in ua and "edg" not in ua and "opr" not in ua:
        browser = "Chrome"
    elif "firefox" in ua:
        browser = "Firefox"
    elif "safari" in ua and "chrome" not in ua:
        browser = "Safari"
    elif "edg" in ua:
        browser = "Edge"
    elif "opr" in ua or "opera" in ua:
        browser = "Opera"

    if "windows" in ua:
        os_label = "Windows"
    elif "macintosh" in ua or "mac os" in ua:
        os_label = "macOS"
    elif "iphone" in ua:
        os_label = "iPhone"
    elif "ipad" in ua:
        os_label = "iPad"
    elif "android" in ua:
        os_label = "Android"
    elif "linux" in ua:
        os_label = "Linux"

    return f"{browser} on {os_label}"


def _build_email_html(
    email: str,
    ip_address: str,
    device: str,
    timestamp: datetime,
) -> str:
    ts_str = timestamp.strftime("%B %d, %Y at %I:%M %p UTC")
    app_url = getattr(settings, "APP_URL", "https://quanttrade.us")

    return f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Sign-In to QuantTrade AI</title>
  <style>
    body {{ margin: 0; padding: 0; background: #060B12; font-family: -apple-system, 'Segoe UI', sans-serif; }}
    .wrapper {{ max-width: 560px; margin: 0 auto; padding: 40px 20px; }}
    .card {{ background: #0D1828; border: 1px solid rgba(0,212,255,0.2); border-radius: 16px; overflow: hidden; }}
    .header {{ background: linear-gradient(135deg, #060B12 0%, #0a1628 100%); padding: 32px; border-bottom: 1px solid rgba(0,212,255,0.15); }}
    .logo {{ display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }}
    .logo-dot {{ width: 8px; height: 8px; border-radius: 50%; background: #00D4FF; box-shadow: 0 0 12px #00D4FF; }}
    .logo-text {{ color: #00D4FF; font-size: 18px; font-weight: 700; letter-spacing: -0.5px; }}
    .header h1 {{ margin: 0; color: #F0F6FF; font-size: 22px; font-weight: 600; }}
    .body {{ padding: 32px; }}
    .alert-line {{ color: #94A3B8; font-size: 15px; line-height: 1.6; margin: 0 0 24px; }}
    .info-table {{ width: 100%; border-collapse: collapse; margin: 0 0 28px; }}
    .info-table tr td {{ padding: 12px 0; border-bottom: 1px solid rgba(71,85,105,0.3); }}
    .info-table tr:last-child td {{ border-bottom: none; }}
    .info-label {{ color: #64748B; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; width: 40%; }}
    .info-value {{ color: #E2E8F0; font-size: 14px; font-family: 'Courier New', monospace; }}
    .ip-badge {{ display: inline-block; background: rgba(0,212,255,0.1); border: 1px solid rgba(0,212,255,0.3); color: #00D4FF; padding: 3px 10px; border-radius: 6px; font-size: 13px; font-family: 'Courier New', monospace; }}
    .cta-section {{ background: rgba(255,71,87,0.08); border: 1px solid rgba(255,71,87,0.25); border-radius: 12px; padding: 20px; margin: 0 0 24px; }}
    .cta-section p {{ margin: 0 0 14px; color: #FCA5A5; font-size: 14px; }}
    .cta-btn {{ display: inline-block; background: #FF4757; color: #fff; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-size: 14px; font-weight: 600; }}
    .footer {{ padding: 24px 32px; border-top: 1px solid rgba(71,85,105,0.2); }}
    .footer p {{ margin: 0; color: #475569; font-size: 12px; line-height: 1.6; }}
    .footer a {{ color: #00D4FF; text-decoration: none; }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="logo">
          <div class="logo-dot"></div>
          <span class="logo-text">QuantTrade AI</span>
        </div>
        <h1>New Sign-In Detected</h1>
      </div>

      <div class="body">
        <p class="alert-line">
          We noticed a new sign-in to your QuantTrade AI account. If this was you, no action is required.
        </p>

        <table class="info-table">
          <tr>
            <td class="info-label">Account</td>
            <td class="info-value">{email}</td>
          </tr>
          <tr>
            <td class="info-label">IP Address</td>
            <td class="info-value"><span class="ip-badge">{ip_address}</span></td>
          </tr>
          <tr>
            <td class="info-label">Device</td>
            <td class="info-value">{device}</td>
          </tr>
          <tr>
            <td class="info-label">Time</td>
            <td class="info-value">{ts_str}</td>
          </tr>
        </table>

        <div class="cta-section">
          <p><strong>Wasn't you?</strong> If you did not sign in, your account may be compromised. Secure it immediately.</p>
          <a href="{app_url}/auth?action=reset-password" class="cta-btn">Secure My Account →</a>
        </div>

        <p style="color:#64748B; font-size:13px; margin:0;">
          For your security, we log all sign-in events. If you have concerns, contact our support team.
        </p>
      </div>

      <div class="footer">
        <p>
          You received this email because a sign-in occurred on your QuantTrade AI account.<br />
          <a href="{app_url}/settings">Manage notification preferences</a> · 
          <a href="{app_url}/terms">Terms of Service</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>
"""


async def send_login_notification(
    email: str,
    ip_address: str,
    user_agent: str,
    timestamp: Optional[datetime] = None,
) -> bool:
    """
    Send a login notification email using the Resend API.
    Fire-and-forget: caller should use asyncio.create_task() to avoid blocking login response.

    Returns True on success, False on failure (never raises — login must not be blocked by email failure).
    """
    if not getattr(settings, "RESEND_API_KEY", None):
        logger.warning("RESEND_API_KEY not configured — skipping login notification email")
        return False

    from_email = getattr(settings, "RESEND_FROM_EMAIL", "QuantTrade <security@quanttrade.us>")

    if timestamp is None:
        timestamp = datetime.now(timezone.utc)

    device = _get_device_label(user_agent)
    html_content = _build_email_html(email, ip_address, device, timestamp)

    payload = {
        "from": from_email,
        "to": [email],
        "subject": f"New sign-in to your QuantTrade AI account from {ip_address}",
        "html": html_content,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                RESEND_SEND_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
            )
            if response.status_code in (200, 201):
                logger.info(
                    "Login notification email sent",
                    extra={"email": email, "ip": ip_address},
                )
                return True
            else:
                logger.warning(
                    "Login notification email failed",
                    extra={"status": response.status_code, "body": response.text[:200]},
                )
                return False
    except Exception as exc:
        # OWASP A10: never let email failure block the user login
        logger.error("Login notification email exception: %s", exc)
        return False
