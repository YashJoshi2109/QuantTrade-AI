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


def test_check_budget_raises_on_daily_limit():
    """_check_budget() raises HTTPException when user has hit free tier limit."""
    from app.api.agentic_stream import _check_budget
    from fastapi import HTTPException
    mock_db = MagicMock()
    with pytest.raises(HTTPException) as exc_info:
        _check_budget(user_id=99, db=mock_db, daily_count=6, daily_limit=5)
    assert exc_info.value.status_code == 429
