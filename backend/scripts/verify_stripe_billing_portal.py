"""
Verify Stripe Customer Portal configurations exist for this account.

Run from backend dir (uses backend/.env via app.config):
  python3 scripts/verify_stripe_billing_portal.py

Stripe Dashboard: Settings → Billing → Customer portal → Save (creates default configuration).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx

from app.config import settings


def main() -> None:
    key = settings.STRIPE_SECRET_KEY
    if not key:
        print("❌ STRIPE_SECRET_KEY is not set (backend/.env)")
        sys.exit(1)

    mode = "live" if key.startswith("sk_live") else "test"
    print(f"Checking Stripe Customer Portal configurations ({mode} mode)…")

    try:
        r = httpx.get(
            "https://api.stripe.com/v1/billing_portal/configurations",
            auth=(key, ""),
            params={"limit": 10},
            timeout=20.0,
        )
    except Exception as exc:
        print(f"❌ Request failed: {exc}")
        sys.exit(1)

    if r.status_code != 200:
        print(f"❌ Stripe API HTTP {r.status_code}: {r.text[:500]}")
        sys.exit(1)

    payload = r.json()
    data = payload.get("data") or []

    if not data:
        print(
            "❌ No Customer portal configurations found.\n\n"
            "Fix in Stripe Dashboard:\n"
            "  Settings → Billing → Customer portal\n"
            "  Turn on features you need, then click Save.\n\n"
            "Then set optional env (if needed):\n"
            "  STRIPE_BILLING_PORTAL_CONFIGURATION_ID=bpc_...\n"
            "(copy from the portal configuration list in Dashboard)"
        )
        sys.exit(1)

    print(f"✅ Found {len(data)} portal configuration(s):\n")
    for c in data:
        print(
            f"  id={c.get('id')}  active={c.get('active')}  is_default={c.get('is_default')}"
        )

    cfg_env = getattr(settings, "STRIPE_BILLING_PORTAL_CONFIGURATION_ID", None)
    if cfg_env and str(cfg_env).strip():
        print(f"\nSTRIPE_BILLING_PORTAL_CONFIGURATION_ID={cfg_env.strip()!r} (will be passed to portal sessions)")
    else:
        print("\nNo STRIPE_BILLING_PORTAL_CONFIGURATION_ID set — Stripe will use the default configuration.")

    defaults = [c for c in data if c.get("is_default")]
    if not defaults:
        print(
            "\n⚠️  No configuration marked is_default=true. If portal sessions still fail, "
            "pick a bpc_... id above and set STRIPE_BILLING_PORTAL_CONFIGURATION_ID."
        )

    print("\n✅ Done.")
    sys.exit(0)


if __name__ == "__main__":
    main()
