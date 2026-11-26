#!/usr/bin/env python3
"""Local-dev wrapper; the CLI lives in app.services.symbol_identity_refresh.

    cd backend && APP_ENV=development python scripts/refresh_symbol_identity.py [--apply]

In the prod container use ``python -m app.services.symbol_identity_refresh``
(``scripts/`` is excluded from the Docker image by .dockerignore).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.symbol_identity_refresh import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
