"""Integration test: full supervisor pipeline with all external calls mocked."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.agentic.agents.shared import AgentResult
from app.services.agentic.retrieval.parent_child import ChunkWithCitation


def _make_cwc() -> ChunkWithCitation:
    return ChunkWithCitation(
        text="Apple faces significant geographic concentration risk with China representing 19% of net sales.",
        citation_label="[Source 1: AAPL 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker="AAPL", company_name="Apple Inc.", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors", score=0.95,
    )


@pytest.mark.asyncio
async def test_supervisor_graph_runs_end_to_end():
    """Full graph: supervisor → dispatch → merge → context_builder returns valid state."""
    chunk = _make_cwc()
    mock_agent_result = AgentResult(
        chunks=[chunk],
        live_data={"AAPL": {"price": 185.5, "change_pct": 1.2}},
    )

    with patch("app.services.agentic.supervisor.AGENT_REGISTRY",
               {
                   "research": AsyncMock(return_value=mock_agent_result),
                   "earnings": AsyncMock(return_value=AgentResult()),
               }):
        from app.services.agentic.supervisor import _build_graph

        graph = _build_graph().compile()
        state = await graph.ainvoke({
            "message":              "What are Apple's biggest risks in China?",
            "routing_decision":     {
                "intent": "STOCK_ANALYSIS",
                "primary_ticker": "AAPL",
                "all_tickers": ["AAPL"],
                "use_stock_context": True,
                "inject_general_knowledge": False,
            },
            "conversation_history": [],
            "active_agents":        [],
            "agent_results":        {},
            "all_chunks":           [],
            "final_context":        "",
            "response":             "",
            "citations":            [],
            "error":                None,
        })

    assert "research" in state["active_agents"] or "research" in state["agent_results"]
    assert len(state["all_chunks"]) >= 1
    assert "[Source 1:" in state["final_context"]
    assert "AAPL" in state["final_context"]
    assert len(state["citations"]) >= 1


@pytest.mark.asyncio
async def test_supervisor_handles_agent_failure_gracefully():
    """Graph continues even if one agent raises an exception."""
    with patch("app.services.agentic.supervisor.AGENT_REGISTRY",
               {"research": AsyncMock(side_effect=Exception("Qdrant timeout"))}):
        from app.services.agentic.supervisor import _build_graph

        graph = _build_graph().compile()
        state = await graph.ainvoke({
            "message":              "Analyze AAPL",
            "routing_decision":     {
                "intent": "STOCK_ANALYSIS",
                "primary_ticker": "AAPL",
                "all_tickers": ["AAPL"],
                "use_stock_context": True,
                "inject_general_knowledge": False,
            },
            "conversation_history": [],
            "active_agents":        [],
            "agent_results":        {},
            "all_chunks":           [],
            "final_context":        "",
            "response":             "",
            "citations":            [],
            "error":                None,
        })

    # Should not raise — error captured in agent_results
    assert "research" in state["agent_results"]
    assert state["agent_results"]["research"].error is not None
