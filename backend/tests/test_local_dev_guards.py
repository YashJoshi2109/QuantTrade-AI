"""Local-dev guard rails: never touch prod DB or prod secrets from a dev box."""
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def _import_db(env_overrides: dict) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k not in {"APP_ENV", "ALLOW_REMOTE_DB", "DATABASE_URL"}}
    env.update(env_overrides)
    return subprocess.run(
        [sys.executable, "-c", "import app.db.database"],
        cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120,
    )


def test_dev_refuses_remote_database():
    r = _import_db({"APP_ENV": "development", "DATABASE_URL": "postgresql://u:p@db.example.rds.amazonaws.com/x"})
    assert r.returncode != 0 and "points at remote host" in r.stderr


def test_dev_allows_local_database():
    r = _import_db({"APP_ENV": "development", "DATABASE_URL": "postgresql://u:p@localhost:5433/x"})
    assert r.returncode == 0, r.stderr


def test_prod_and_explicit_override_allow_remote():
    remote = "postgresql://u:p@db.example.rds.amazonaws.com/x"
    assert _import_db({"DATABASE_URL": remote}).returncode == 0
    assert _import_db({"APP_ENV": "development", "ALLOW_REMOTE_DB": "1", "DATABASE_URL": remote}).returncode == 0


def test_dev_skips_aws_secrets(monkeypatch):
    from app import config_aws

    called = {"n": 0}
    monkeypatch.setattr(config_aws, "load_secrets_from_aws", lambda *a, **k: called.__setitem__("n", 1) or {"X": "1"})
    monkeypatch.setenv("APP_ENV", "development")
    config_aws.inject_aws_secrets()
    assert called["n"] == 0
