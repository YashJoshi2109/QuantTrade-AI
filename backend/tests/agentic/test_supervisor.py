"""Tests for LangGraph supervisor state machine."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.agentic.agents.shared import AgentResult
from app.services.agentic.retrieval.parent_child import ChunkWithCitation


def _make_cwc(ticker: str = "AAPL") -> ChunkWithCitation:
    return ChunkWithCitation(
        text="Apple faces supply chain risks.",
        citation_label=f"[Source 1: {ticker} 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker=ticker, company_name=ticker, filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors",
        score=0.9,
    )


def _make_routing(intent: str = "STOCK_ANALYSIS", ticker: str = "AAPL") -> dict:
    return {
        "intent": intent,
        "primary_ticker": ticker,
        "all_tickers": [ticker],
        "use_stock_context": True,
        "inject_general_knowledge": False,
    }


def test_supervisor_node_sets_active_agents_for_stock_analysis():
    """supervisor_node() sets active_agents=['research'] for STOCK_ANALYSIS."""
    from app.services.agentic.supervisor import supervisor_node

    state = {
        "message": "Analyze AAPL",
        "routing_decision": _make_routing("STOCK_ANALYSIS"),
        "conversation_history": [],
        "active_agents": [],
        "agent_results": {},
        "all_chunks": [],
        "final_context": "",
        "response": "",
        "citations": [],
        "error": None,
    }
    result = supervisor_node(state)
    assert "research" in result["active_agents"]


def test_supervisor_node_sets_comparison_agents():
    """supervisor_node() sets active_agents=['comparison'] for COMPARISON intent."""
    from app.services.agentic.supervisor import supervisor_node

    state = {
        "message": "Compare AAPL vs MSFT",
        "routing_decision": {**_make_routing("COMPARISON"), "all_tickers": ["AAPL", "MSFT"]},
        "conversation_history": [], "active_agents": [], "agent_results": {},
        "all_chunks": [], "final_context": "", "response": "", "citations": [], "error": None,
    }
    result = supervisor_node(state)
    assert "comparison" in result["active_agents"]


@pytest.mark.asyncio
async def test_parallel_dispatch_node_runs_all_active_agents():
    """parallel_dispatch_node() calls each active agent and collects results."""
    agent_result = AgentResult(chunks=[_make_cwc()], live_data={"AAPL": {"price": 185.0}})

    with patch("app.services.agentic.supervisor.AGENT_REGISTRY",
               {"research": AsyncMock(return_value=agent_result)}):
        from app.services.agentic.supervisor import parallel_dispatch_node

        state = {
            "message": "Analyze AAPL",
            "routing_decision": _make_routing(),
            "conversation_history": [],
            "active_agents": ["research"],
            "agent_results": {},
            "all_chunks": [],
            "final_context": "",
            "response": "",
            "citations": [],
            "error": None,
        }
        result = await parallel_dispatch_node(state)

    assert "research" in result["agent_results"]
    assert result["agent_results"]["research"].chunks[0].ticker == "AAPL"


@pytest.mark.asyncio
async def test_merge_node_deduplicates_chunks():
    """merge_node() deduplicates chunks with same citation_label across agents."""
    from app.services.agentic.supervisor import merge_node

    chunk = _make_cwc()
    state = {
        "message": "", "routing_decision": {}, "conversation_history": [],
        "active_agents": ["research"],
        "agent_results": {
            "research": AgentResult(chunks=[chunk, chunk]),  # duplicate
        },
        "all_chunks": [], "final_context": "", "response": "", "citations": [], "error": None,
    }
    result = await merge_node(state)
    # Dedup: same citation_label → should appear once
    labels = [c.citation_label for c in result["all_chunks"]]
    assert labels.count(chunk.citation_label) == 1


@pytest.mark.asyncio
async def test_context_builder_node_sets_final_context():
    """context_builder_node() sets final_context from chunks + live_data."""
    from app.services.agentic.supervisor import context_builder_node

    chunk = _make_cwc()
    state = {
        "message": "test", "routing_decision": {}, "conversation_history": [],
        "active_agents": ["research"],
        "agent_results": {
            "research": AgentResult(chunks=[chunk], live_data={"AAPL": {"price": 185.0}}),
        },
        "all_chunks": [chunk], "final_context": "", "response": "", "citations": [], "error": None,
    }
    result = await context_builder_node(state)
    assert "[Source 1:" in result["final_context"]
    assert "AAPL" in result["final_context"]
