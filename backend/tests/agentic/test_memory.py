"""Tests for Redis conversation memory (sliding window + Haiku compression)."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_load_memory_returns_empty_on_miss():
    """load_memory() returns empty ConversationMemory when key not in Redis."""
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(return_value=None)

    with patch("app.services.agentic.memory._redis_client", return_value=mock_redis):
        from app.services.agentic.memory import load_memory
        mem = await load_memory(user_id=1, conversation_id="conv-1")

    assert mem.turns == []
    assert mem.summary == ""


@pytest.mark.asyncio
async def test_load_memory_deserializes_json():
    """load_memory() deserializes stored JSON back to ConversationMemory."""
    import json
    stored = json.dumps({"turns": [{"role": "user", "content": "Hi"}], "summary": "greeting"})
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(return_value=stored)

    with patch("app.services.agentic.memory._redis_client", return_value=mock_redis):
        from app.services.agentic.memory import load_memory
        mem = await load_memory(user_id=1, conversation_id="conv-1")

    assert len(mem.turns) == 1
    assert mem.turns[0]["role"] == "user"
    assert mem.summary == "greeting"


@pytest.mark.asyncio
async def test_save_turn_appends_and_stores():
    """save_turn() appends both user and assistant turns, persists to Redis."""
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock(return_value=True)

    with patch("app.services.agentic.memory._redis_client", return_value=mock_redis):
        from app.services.agentic.memory import ConversationMemory, save_turn
        mem = ConversationMemory(turns=[], summary="")
        await save_turn(mem, "user", "Hello", user_id=1, conversation_id="conv-1")
        await save_turn(mem, "assistant", "Hi there", user_id=1, conversation_id="conv-1")

    assert len(mem.turns) == 2
    assert mock_redis.setex.call_count == 2


@pytest.mark.asyncio
async def test_save_turn_triggers_compression_at_8_turns():
    """save_turn() calls _compress_oldest_turns when turn count reaches 8."""
    import json
    turns = [{"role": "user", "content": f"msg {i}"} for i in range(7)]
    stored = json.dumps({"turns": turns, "summary": ""})
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(return_value=stored)
    mock_redis.setex = AsyncMock(return_value=True)

    mock_haiku_response = MagicMock()
    mock_haiku_response.content = "Compressed: user asked about stocks"
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_haiku_response)

    with patch("app.services.agentic.memory._redis_client", return_value=mock_redis), \
         patch("app.services.agentic.memory.get_llm_haiku", return_value=mock_llm):
        from app.services.agentic.memory import ConversationMemory, save_turn
        mem = ConversationMemory(turns=list(turns), summary="")
        # Adding the 8th turn should trigger compression of first 4
        await save_turn(mem, "assistant", "8th message", user_id=1, conversation_id="conv-1")

    # After compression: 4 oldest replaced by summary, plus new turn = 5 total
    assert len(mem.turns) <= 5
    assert mem.summary != ""
