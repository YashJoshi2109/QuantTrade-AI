"""Tests for the 6 agent functions."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.agentic.agents.shared import AgentResult


def _make_state(intent: str = "STOCK_ANALYSIS", tickers: list = None) -> dict:
    return {
        "message": "What are Apple's risks in China?",
        "routing_decision": {
            "intent": intent,
            "primary_ticker": (tickers or ["AAPL"])[0] if tickers or ["AAPL"] else None,
            "all_tickers": tickers or ["AAPL"],
            "use_stock_context": True,
            "inject_general_knowledge": False,
        },
        "conversation_history": [],
        "active_agents": [],
        "agent_results": {},
        "all_chunks": [],
        "final_context": "",
        "response": "",
        "citations": [],
        "error": None,
    }


def _make_cwc():
    from app.services.agentic.retrieval.parent_child import ChunkWithCitation
    return ChunkWithCitation(
        text="Apple faces supply chain risk in China.",
        citation_label="[Source 1: AAPL 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors",
        score=0.92,
    )


@pytest.mark.asyncio
async def test_research_agent_calls_sec_search():
    """research agent calls search_sec_filings for the primary ticker."""
    state = _make_state()
    chunks = [_make_cwc()]

    with patch("app.services.agentic.agents.research._search_sec_filings_impl",
               new_callable=AsyncMock, return_value=chunks), \
         patch("app.services.agentic.agents.research.get_realtime_quote_impl",
               new_callable=AsyncMock, return_value={"price": 185.0}), \
         patch("app.services.agentic.agents.research.get_fundamentals_impl",
               new_callable=AsyncMock, return_value={"ticker": "AAPL"}), \
         patch("app.services.agentic.agents.research.get_news_impl",
               new_callable=AsyncMock, return_value=[]):
        from app.services.agentic.agents.research import run_research_agent
        result = await run_research_agent(state)

    assert isinstance(result, AgentResult)
    assert len(result.chunks) == 1
    assert result.chunks[0].ticker == "AAPL"


@pytest.mark.asyncio
async def test_comparison_agent_searches_each_ticker():
    """comparison agent calls search_sec_filings for each ticker."""
    state = _make_state(intent="COMPARISON", tickers=["AAPL", "MSFT"])

    def _make_cwc_for(ticker):
        from app.services.agentic.retrieval.parent_child import ChunkWithCitation
        return ChunkWithCitation(
            text=f"{ticker} risk section.",
            citation_label=f"[Source 1: {ticker} 10-K 2024]",
            ticker=ticker, company_name=ticker, filing_type="10-K",
            filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors",
            score=0.9,
        )

    call_count = 0
    async def _mock_search(query, tickers=None, **kwargs):
        nonlocal call_count
        call_count += 1
        return [_make_cwc_for((tickers or ["AAPL"])[0])]

    with patch("app.services.agentic.agents.comparison._search_sec_filings_impl",
               side_effect=_mock_search), \
         patch("app.services.agentic.agents.comparison.get_realtime_quote_impl",
               new_callable=AsyncMock, return_value={"price": 100.0}):
        from app.services.agentic.agents.comparison import run_comparison_agent
        result = await run_comparison_agent(state)

    assert call_count == 2  # one per ticker
    assert isinstance(result, AgentResult)


@pytest.mark.asyncio
async def test_general_agent_searches_without_ticker_filter():
    """general agent calls search_sec_filings with tickers=None."""
    state = _make_state(intent="GENERAL_ADVICE", tickers=[])
    state["routing_decision"]["use_stock_context"] = False
    state["routing_decision"]["inject_general_knowledge"] = True
    chunks = [_make_cwc()]

    captured_call = {}
    async def _mock_search(query, tickers=None, **kwargs):
        captured_call["tickers"] = tickers
        return chunks

    with patch("app.services.agentic.agents.general._search_sec_filings_impl",
               side_effect=_mock_search), \
         patch("app.services.agentic.agents.general.get_macro_data_impl",
               new_callable=AsyncMock, return_value={"FED_RATE": 5.25}):
        from app.services.agentic.agents.general import run_general_agent
        result = await run_general_agent(state)

    assert captured_call.get("tickers") is None or captured_call.get("tickers") == []
    assert isinstance(result, AgentResult)
