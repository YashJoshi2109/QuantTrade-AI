#!/usr/bin/env python3
"""Ticker universe audit (local wrapper); the logic lives in app.services.ticker_audit.

Idempotent and read-only unless --apply is given.

    cd backend && python scripts/audit_ticker_universe.py --prod-api https://www.quanttrade.us \
        --completeness all --markdown ../docs/TICKER_AUDIT.md

In the prod container use ``python -m app.services.ticker_audit --db ...``
(``scripts/`` is excluded from the Docker image by .dockerignore).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.ticker_audit import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
