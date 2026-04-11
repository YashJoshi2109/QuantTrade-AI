"""
Transactional emails: billing (Brevo + Resend fallback) and Pro watchlist alerts
(dual send via Brevo and Resend when both API keys are configured).
"""
from __future__ import annotations

from app.config import settings
from app.services.email_service import (
    send_email_sync,
    send_redundant_transactional_email_sync,
)


def _feedback_href() -> str:
    base = (getattr(settings, "APP_URL", None) or "https://quanttrade.us").rstrip("/")
    return f"{base}/settings?feedback=billing"


def send_subscription_cancel_requested_email(
    to_email: str,
    *,
    plan_label: str,
    access_until: str | None,
    at_period_end: bool,
) -> tuple[bool, str]:
    """User requested cancel (typically at period end)."""
    when = (
        f"You'll keep Pro access until <strong>{access_until}</strong>."
        if access_until and at_period_end
        else "Your subscription has been updated."
    )
    html = f"""
    <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#060B12;padding:36px 20px;">
      <div style="background:#0D1828;border:1px solid rgba(148,163,184,0.25);border-radius:16px;padding:28px;">
        <p style="color:#e2e8f0;font-size:16px;margin:0 0 12px;">Subscription update</p>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 16px;">
          We’ve received your request regarding <strong style="color:#38bdf8;">{plan_label}</strong>.
          {when}
        </p>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 20px;">
          Billing is processed securely by <strong>Stripe</strong>. You can manage payment methods or reactivate anytime from
          <strong>Settings → Manage billing</strong>.
        </p>
        <a href="{_feedback_href()}" style="display:inline-block;background:linear-gradient(90deg,#06b6d4,#0ea5e9);color:#0f172a;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;font-size:14px;">
          Share quick feedback
        </a>
        <p style="color:#64748b;font-size:12px;margin:20px 0 0;line-height:1.5;">
          Your feedback helps us improve QuantTrade AI. If you did not request this change, secure your account and contact support.
        </p>
      </div>
    </div>
    """
    return send_email_sync(
        to_email,
        "QuantTrade AI — Subscription update",
        html,
    )


def send_watchlist_price_alert_email(
    to_email: str,
    *,
    symbol: str,
    old_price: float,
    new_price: float,
    change_pct: float,
) -> tuple[bool, str]:
    direction = "up" if new_price >= old_price else "down"
    html = f"""
    <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#060B12;padding:36px 20px;">
      <div style="background:#0D1828;border:1px solid rgba(6,182,212,0.35);border-radius:16px;padding:28px;">
        <p style="color:#22d3ee;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 8px;">Pro watchlist alert</p>
        <p style="color:#f8fafc;font-size:20px;font-weight:800;margin:0 0 8px;">{symbol} moved {direction}</p>
        <p style="color:#94a3b8;font-size:15px;margin:0 0 16px;">
          Price: <strong style="color:#e2e8f0;">${old_price:.2f}</strong> to <strong style="color:#e2e8f0;">${new_price:.2f}</strong>
          ({change_pct:+.2f}%)
        </p>
        <p style="color:#64748b;font-size:12px;margin:0;">
          You’re receiving this because Pro email alerts are enabled in Settings.
        </p>
      </div>
    </div>
    """
    text_plain = (
        f"Pro watchlist alert: {symbol} moved {direction}. "
        f"Price ${old_price:.2f} -> ${new_price:.2f} ({change_pct:+.2f}%). "
        f"You receive this because Pro email alerts are enabled in Settings."
    )
    return send_redundant_transactional_email_sync(
        to_email,
        f"QuantTrade AI - {symbol} price alert ({change_pct:+.2f}%)",
        html,
        text_plain=text_plain,
    )


def send_watchlist_news_alert_email(
    to_email: str,
    *,
    symbol: str,
    title: str,
    url: str | None,
) -> tuple[bool, str]:
    link = f'<a href="{url}" style="color:#38bdf8;">Read article</a>' if url else ""
    html = f"""
    <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#060B12;padding:36px 20px;">
      <div style="background:#0D1828;border:1px solid rgba(251,191,36,0.35);border-radius:16px;padding:28px;">
        <p style="color:#fbbf24;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;margin:0 0 8px;">Breaking news · watchlist</p>
        <p style="color:#f8fafc;font-size:17px;font-weight:700;margin:0 0 10px;">{symbol}</p>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.5;margin:0 0 12px;">{title}</p>
        <p style="color:#94a3b8;font-size:13px;margin:0;">{link}</p>
      </div>
    </div>
    """
    url_line = f" Link: {url}" if url else ""
    text_plain = f"Watchlist news ({symbol}): {title}.{url_line}"
    return send_redundant_transactional_email_sync(
        to_email,
        f"QuantTrade AI - News: {symbol}",
        html,
        text_plain=text_plain,
    )
