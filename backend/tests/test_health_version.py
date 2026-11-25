"""/health reports the image's git SHA so deploys can verify what prod runs."""
from fastapi.testclient import TestClient


def test_health_reports_git_sha(monkeypatch):
    monkeypatch.setenv("GIT_SHA", "abc123def456")
    from app.main import app

    r = TestClient(app).get("/health")
    assert r.status_code == 200
    assert r.json()["version"] == "abc123def456"


def test_health_version_defaults_to_unknown(monkeypatch):
    monkeypatch.delenv("GIT_SHA", raising=False)
    from app.main import app

    assert TestClient(app).get("/health").json()["version"] == "unknown"
