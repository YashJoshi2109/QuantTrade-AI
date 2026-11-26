"""
AWS Secrets Manager integration for QuantTrade AI.

Loads secrets from AWS Secrets Manager on startup and injects into os.environ.
Falls back to .env file for local development.
"""

import json
import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

_secrets_cache: dict = {"data": None, "expires": 0}
_CACHE_TTL = 3600  # Re-fetch secrets every hour


def load_secrets_from_aws(secret_name: str = "quanttrade/backend", region: str = "us-east-2") -> Optional[dict]:
    """Load secrets from AWS Secrets Manager. Returns dict of key-value pairs."""
    now = time.time()
    if _secrets_cache["data"] and now < _secrets_cache["expires"]:
        return _secrets_cache["data"]

    try:
        import boto3
        client = boto3.client("secretsmanager", region_name=region)
        response = client.get_secret_value(SecretId=secret_name)
        parsed = json.loads(response["SecretString"])
        num_keys = len(parsed)
        _secrets_cache["data"] = parsed
        _secrets_cache["expires"] = now + _CACHE_TTL
        logger.info("Loaded %d keys from AWS Secrets Manager", num_keys)
        return parsed
    except ImportError:
        logger.debug("boto3 not installed — using .env file")
        return None
    except Exception:
        logger.warning("Failed to load from AWS Secrets Manager — falling back to .env", exc_info=True)
        return None


def inject_aws_secrets():
    """Load secrets from AWS Secrets Manager and inject into os.environ.

    Only injects keys that are NOT already set in the environment,
    so explicit env vars and .env files take precedence.
    """
    # Local dev must not pull production secrets just because the developer's
    # shell happens to have AWS credentials (e.g. after `aws login`).
    if os.environ.get("APP_ENV", "").lower() in {"development", "dev", "local"}:
        logger.info("APP_ENV=development — skipping AWS Secrets Manager")
        return

    region = os.environ.get("AWS_REGION", "us-east-2")
    secret_name = os.environ.get("AWS_SECRET_NAME", "quanttrade/backend")

    loaded = load_secrets_from_aws(secret_name, region)
    if not loaded:
        return

    injected = 0
    total = len(loaded)
    shadowed = []
    for key, value in loaded.items():
        if key not in os.environ:
            os.environ[key] = str(value)
            injected += 1
        elif os.environ[key] != str(value):
            shadowed.append(key)

    if shadowed:
        # The env (deploy-written .env from GitHub Actions secrets) wins. A key
        # rotated only in Secrets Manager is silently ignored, so name them
        # (names only, never values).
        logger.warning(
            "Env overrides a different AWS Secrets Manager value for: %s. "
            "Update the GitHub Actions secret too, or rotations will not take effect.",
            ", ".join(sorted(shadowed)),
        )

    logger.info("Injected %d secrets from AWS (skipped %d already set)", injected, total - injected)
