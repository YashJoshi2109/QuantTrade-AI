"""Tests for Stage 2: Hypothetical Document Embeddings (HyDE)."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_generate_hypothetical_document_returns_string():
    """generate_hypothetical_document() returns non-empty string from Haiku."""
    hypo_text = (
        "Apple faces significant supply chain concentration risk with approximately "
        "19% of revenue from China-based manufacturing operations."
    )
    mock_response = MagicMock()
    mock_response.content = hypo_text

    with patch("app.services.agentic.retrieval.hyde.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.hyde import generate_hypothetical_document

        result = await generate_hypothetical_document("Apple China supply chain risk")

    assert isinstance(result, str)
    assert len(result) > 50


@pytest.mark.asyncio
async def test_get_hyde_embedding_returns_1536_dim_vector():
    """get_hyde_embedding() embeds the hypothetical doc with Titan v2 (1536d)."""
    mock_vector = [0.01] * 1536
    hypo_text = "Hypothetical document about supply chain risks."
    mock_response = MagicMock()
    mock_response.content = hypo_text

    with patch("app.services.agentic.retrieval.hyde.get_llm_haiku") as mock_haiku_fn, \
         patch("app.services.agentic.retrieval.hyde.embed_query") as mock_embed:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm
        mock_embed.return_value = mock_vector

        from app.services.agentic.retrieval.hyde import get_hyde_embedding

        vec = await get_hyde_embedding("Apple China supply chain risk")

    assert len(vec) == 1536
    assert vec[0] == pytest.approx(0.01)


@pytest.mark.asyncio
async def test_get_hyde_embedding_falls_back_on_error():
    """get_hyde_embedding() returns None when Haiku call fails."""
    with patch("app.services.agentic.retrieval.hyde.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(side_effect=Exception("Bedrock timeout"))
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.hyde import get_hyde_embedding

        result = await get_hyde_embedding("any query")

    assert result is None
