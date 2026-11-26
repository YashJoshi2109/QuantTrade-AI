"""Email provider failure hints, key health check, and secret-shadowing warning."""
import logging

import pytest

from app import config_aws
from app.services import email_service as es


@pytest.mark.parametrize(
    "status,needle",
    [
        (401, "rejected the API key"),
        (403, "rejected the API key"),
        (400, "verified sender"),
        (429, "rate limit"),
        (500, "unexpected error"),
    ],
)
def test_failure_hint_matches_status(status, needle):
    assert needle in es._failure_hint("Brevo", status, "BREVO_API_KEY", "BREVO_FROM_EMAIL")


def test_auth_failure_hint_does_not_blame_sender():
    hint = es._failure_hint("Brevo", 401, "BREVO_API_KEY", "BREVO_FROM_EMAIL")
    assert "BREVO_API_KEY" in hint and "BREVO_FROM_EMAIL" not in hint


@pytest.fixture(autouse=True)
def _reset_cache():
    es._key_check_cache.update(at=0.0, result=None)
    yield
    es._key_check_cache.update(at=0.0, result=None)


def _keys(monkeypatch, brevo, resend):
    monkeypatch.setattr(es.settings, "BREVO_API_KEY", brevo, raising=False)
    monkeypatch.setattr(es.settings, "RESEND_API_KEY", resend, raising=False)


def test_status_not_configured(monkeypatch):
    _keys(monkeypatch, None, None)
    assert es.email_provider_status() == "not_configured"


def test_status_ok_when_any_provider_valid(monkeypatch):
    _keys(monkeypatch, "b", "r")
    monkeypatch.setattr(es, "_key_is_valid", lambda name, key: name == "resend")
    assert es.email_provider_status() == "ok"


def test_status_degraded_when_all_rejected(monkeypatch):
    _keys(monkeypatch, "b", "r")
    monkeypatch.setattr(es, "_key_is_valid", lambda name, key: False)
    assert es.email_provider_status() == "degraded"


def test_status_is_cached(monkeypatch):
    _keys(monkeypatch, "b", None)
    calls = []
    monkeypatch.setattr(es, "_key_is_valid", lambda name, key: calls.append(name) or True)
    es.email_provider_status()
    es.email_provider_status()
    assert calls == ["brevo"]


def test_shadowed_secret_is_warned_by_name_only(monkeypatch, caplog):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.setenv("BREVO_API_KEY", "old-value")
    monkeypatch.setenv("SAME_KEY", "same")
    monkeypatch.delenv("NEW_KEY", raising=False)
    monkeypatch.setattr(
        config_aws,
        "load_secrets_from_aws",
        lambda *a, **k: {"BREVO_API_KEY": "new-value", "SAME_KEY": "same", "NEW_KEY": "x"},
    )
    with caplog.at_level(logging.WARNING, logger=config_aws.logger.name):
        config_aws.inject_aws_secrets()
    text = caplog.text
    assert "BREVO_API_KEY" in text and "SAME_KEY" not in text
    assert "old-value" not in text and "new-value" not in text
    monkeypatch.delenv("NEW_KEY", raising=False)
