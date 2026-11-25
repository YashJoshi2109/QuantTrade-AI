"""Tests for the new agentic SSE stream endpoint."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def test_guardrails_injects_disclaimer_when_missing():
    """apply_guardrails() adds disclaimer if not present in response."""
    from app.api.agentic_stream import apply_guardrails
    response = "Apple stock analysis here. Buy AAPL."
    result = apply_guardrails(response)
    assert "informational purposes" in result.lower() or "not financial advice" in result.lower()


def test_guardrails_does_not_duplicate_disclaimer():
    """apply_guardrails() does not add disclaimer if already present."""
    from app.api.agentic_stream import apply_guardrails
    response = "Analysis here. *This is AI-generated analysis for informational purposes only.*"
    result = apply_guardrails(response)
    count = result.lower().count("informational purposes")
    assert count == 1


def test_daily_limit_raises_429_with_upgrade_message(monkeypatch):
    """The copilot's daily cap now lives in ai_guard (require_llm_quota) — same UX."""
    from fastapi import HTTPException
    from app.services import ai_guard
    monkeypatch.setenv("LLM_FREE_REQ_PER_DAY", "5")
    monkeypatch.setenv("LLM_FREE_REQ_PER_MIN", "100")
    ctx = ai_guard.GuardContext(feature="copilot", user_id=99, tier="free")
    for _ in range(5):
        ai_guard.admit_request(ctx)
    with pytest.raises(HTTPException) as exc_info:
        ai_guard.admit_request(ctx)
    assert exc_info.value.status_code == 429
    assert "Upgrade to Pro" in exc_info.value.detail
