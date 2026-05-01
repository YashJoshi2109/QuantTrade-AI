"""Tests for market, news, and macro tools."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_get_realtime_quote_returns_dict():
    """get_realtime_quote() returns price data dict for a ticker."""
    mock_quote = {"price": 185.5, "change_pct": 1.2, "volume": 55000000}

    with patch("app.services.agentic.tools.market_tool.QuoteCacheService") as mock_qcs:
        mock_svc = MagicMock()
        mock_svc.get_quote = AsyncMock(return_value=mock_quote)
        mock_qcs.return_value = mock_svc

        from app.services.agentic.tools.market_tool import get_realtime_quote_impl

        result = await get_realtime_quote_impl("AAPL")

    assert result["price"] == pytest.approx(185.5)
    assert result["change_pct"] == pytest.approx(1.2)


@pytest.mark.asyncio
async def test_get_realtime_quote_handles_error():
    """get_realtime_quote() returns error dict on failure."""
    with patch("app.services.agentic.tools.market_tool.QuoteCacheService") as mock_qcs:
        mock_svc = MagicMock()
        mock_svc.get_quote = AsyncMock(side_effect=Exception("Finnhub timeout"))
        mock_qcs.return_value = mock_svc

        from app.services.agentic.tools.market_tool import get_realtime_quote_impl

        result = await get_realtime_quote_impl("AAPL")

    assert "error" in result


@pytest.mark.asyncio
async def test_get_news_returns_list():
    """get_news() returns list of news items."""
    mock_articles = [
        {"title": "Apple Reports Record Q4", "url": "https://example.com/1"},
        {"title": "AAPL Beats Estimates", "url": "https://example.com/2"},
    ]

    with patch("app.services.agentic.tools.news_tool._fetch_news",
               new_callable=AsyncMock, return_value=mock_articles):
        from app.services.agentic.tools.news_tool import get_news_impl

        result = await get_news_impl("AAPL", limit=2)

    assert len(result) == 2
    assert result[0]["title"] == "Apple Reports Record Q4"


@pytest.mark.asyncio
async def test_get_macro_data_returns_dict():
    """get_macro_data() returns macro indicators dict."""
    with patch("app.services.agentic.tools.macro_tool._fetch_fred",
               new_callable=AsyncMock, return_value={"GDP_GROWTH": 2.8, "CPI": 3.1}):
        from app.services.agentic.tools.macro_tool import get_macro_data_impl

        result = await get_macro_data_impl(["GDP_GROWTH", "CPI"])

    assert result["GDP_GROWTH"] == pytest.approx(2.8)
