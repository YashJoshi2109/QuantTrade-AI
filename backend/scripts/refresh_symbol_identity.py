#!/usr/bin/env python3
"""Refresh symbols-table company identity from SEC's ticker map.

Finds tickers whose company changed (delisted, merged, renamed or reassigned,
e.g. PARA after the Paramount-Skydance merger) and fixes the symbols table:

  RENAME    our name disagrees with the company SEC now lists for the ticker
  PURGE     cached EDGAR filings belong to a different CIK than SEC now maps the
            ticker to (deleted so the next Research view re-syncs the right filer)
  ADD       a known successor ticker (PSKY for PARA) is missing from symbols
  DELISTED  a known changed ticker is gone from SEC's map (report only)

Dry-run by default: prints the plan and writes nothing.

Usage (local dev stack, see docs/LOCAL_DEV.md):
    cd backend
    APP_ENV=development python scripts/refresh_symbol_identity.py            # dry run
    APP_ENV=development python scripts/refresh_symbol_identity.py --apply    # write
    python scripts/refresh_symbol_identity.py --tickers PARA,PSKY,SQ
    python scripts/refresh_symbol_identity.py --sec-json company_tickers.json  # offline map

Against production it additionally requires --allow-production. Review the
dry-run output first; renames come straight from SEC's ticker map.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--tickers", help="comma-separated subset to check")
    ap.add_argument("--sec-json", help="local copy of https://www.sec.gov/files/company_tickers.json")
    ap.add_argument("--no-purge-edgar", action="store_true", help="do not delete stale cached EDGAR rows")
    ap.add_argument("--allow-production", action="store_true", help="required when APP_ENV=production")
    args = ap.parse_args(argv)

    env = os.environ.get("APP_ENV", "development").lower()
    if env in ("production", "prod") and not args.allow_production:
        print("Refusing to run with APP_ENV=production without --allow-production.", file=sys.stderr)
        return 2

    from app.db.database import SessionLocal
    from app.services.symbol_identity_refresh import apply_plan, fetch_sec_ticker_map, load_rows, plan_refresh

    if SessionLocal is None:
        print("No database configured (DATABASE_URL).", file=sys.stderr)
        return 2

    sec_map = fetch_sec_ticker_map(args.sec_json)
    print(f"SEC ticker map: {len(sec_map)} tickers")

    db = SessionLocal()
    try:
        host = db.get_bind().url.host or "local"
        print(f"Database host: {host}  (APP_ENV={env})")
        rows = load_rows(db)
        existing = {r.symbol.upper() for r in rows}
        if args.tickers:
            wanted = {t.strip().upper() for t in args.tickers.split(",") if t.strip()}
            rows = [r for r in rows if r.symbol.upper() in wanted]
        plan = plan_refresh(rows, sec_map, existing=existing)
        print(f"Checked {plan.checked} equity symbols ({plan.not_in_sec} not in SEC map: "
              "foreign listings, OTC, or delisted)")
        for a in plan.actions:
            print("  " + a.describe())
        if not plan.actions:
            print("No identity changes needed.")
            return 0
        if not args.apply:
            print(f"\nDry run: {len(plan.actions)} action(s). Re-run with --apply to write.")
            return 0
        done = apply_plan(db, plan, purge_edgar=not args.no_purge_edgar)
        print(f"Applied: {done}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
