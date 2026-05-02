"""LangGraph supervisor state machine for the Agentic RAG Copilot.

Graph:
  START -> supervisor_node -> parallel_dispatch_node -> merge_node
        -> context_builder_node -> END

LLM streaming happens outside the graph in the SSE endpoint.
"""
from __future__ import annotations

import asyncio
import logging
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.services.agentic.agents.shared import AgentResult
from app.services.agentic.agents.research   import run_research_agent
from app.services.agentic.agents.comparison import run_comparison_agent
from app.services.agentic.agents.screener   import run_screener_agent
from app.services.agentic.agents.portfolio  import run_portfolio_agent
from app.services.agentic.agents.earnings   import run_earnings_agent
from app.services.agentic.agents.general    import run_general_agent
from app.services.agentic.context_builder   import build_context
from app.services.agentic.retrieval.parent_child import ChunkWithCitation

logger = logging.getLogger(__name__)

# ── Agent registry ─────────────────────────────────────────────────────────────
AGENT_REGISTRY: dict = {
    "research":   run_research_agent,
    "comparison": run_comparison_agent,
    "screener":   run_screener_agent,
    "portfolio":  run_portfolio_agent,
    "earnings":   run_earnings_agent,
    "general":    run_general_agent,
}

# ── Intent → agents mapping ────────────────────────────────────────────────────
INTENT_TO_AGENTS: dict[str, list[str]] = {
    # lowercase (from CopilotRouter Intent.value — what arrives at runtime)
    "stock_analysis":   ["research"],
    "comparison":       ["comparison"],
    "screener":         ["screener"],
    "portfolio_advice": ["portfolio"],
    "earnings":         ["earnings"],
    "general_advice":   ["general"],
    "education":        ["general"],
    "market_overview":  ["general"],
    "sector":           ["general"],
    "text":             ["general"],
    "greeting":         ["general"],
    "off_topic":        ["general"],
}

# ── State schema ───────────────────────────────────────────────────────────────
class CopilotState(TypedDict):
    message:              str
    routing_decision:     dict
    conversation_history: list[dict]
    active_agents:        list[str]
    agent_results:        dict
    all_chunks:           list
    final_context:        str
    response:             str
    citations:            list[dict]
    error:                str | None


# ── Graph nodes ────────────────────────────────────────────────────────────────

def supervisor_node(state: CopilotState) -> dict:
    """Route: pick active agents based on intent from routing_decision."""
    intent = state["routing_decision"].get("intent", "GENERAL_ADVICE")
    intent_str = intent.value if hasattr(intent, "value") else str(intent)
    active = list(INTENT_TO_AGENTS.get(intent_str, ["general"]))

    # STOCK_ANALYSIS also runs earnings agent for comprehensive coverage
    rd = state["routing_decision"]
    if intent_str == "stock_analysis" and rd.get("use_stock_context"):
        if "earnings" not in active:
            active = active + ["earnings"]

    logger.info("Supervisor: intent=%s → agents=%s", intent_str, active)
    return {"active_agents": active}


async def parallel_dispatch_node(state: CopilotState) -> dict:
    """Fan-out: run all active agents in parallel via asyncio.gather."""
    active = state.get("active_agents", ["general"])
    tasks  = [
        AGENT_REGISTRY[name](state)
        for name in active
        if name in AGENT_REGISTRY
    ]

    if not tasks:
        return {"agent_results": {}}

    results = await asyncio.gather(*tasks, return_exceptions=True)

    agent_results: dict = {}
    for name, result in zip(active, results):
        if isinstance(result, Exception):
            logger.warning("Agent %s failed: %s", name, result)
            agent_results[name] = AgentResult(error=str(result))
        else:
            agent_results[name] = result

    return {"agent_results": agent_results}


async def merge_node(state: CopilotState) -> dict:
    """Merge + deduplicate chunks from all agents, build citations list."""
    seen_labels: set[str] = set()
    all_chunks:  list[ChunkWithCitation] = []

    for agent_result in state.get("agent_results", {}).values():
        if isinstance(agent_result, AgentResult) and agent_result.chunks:
            for chunk in agent_result.chunks:
                if chunk.citation_label not in seen_labels:
                    seen_labels.add(chunk.citation_label)
                    all_chunks.append(chunk)

    # Sort by score descending
    all_chunks.sort(key=lambda c: c.score, reverse=True)

    citations = [
        {
            "label":       c.citation_label,
            "ticker":      c.ticker,
            "filing_type": c.filing_type,
            "fiscal_year": c.fiscal_year,
            "section":     c.section,
            "filed_date":  c.filed_date,
            "score":       c.score,
            "snippet":     c.text[:320] if c.text else "",
        }
        for c in all_chunks
    ]

    return {"all_chunks": all_chunks, "citations": citations}


async def context_builder_node(state: CopilotState) -> dict:
    """Assemble token-budgeted context string for the LLM node."""
    # Aggregate live_data from all agents
    live_data: dict = {}
    for agent_result in state.get("agent_results", {}).values():
        if isinstance(agent_result, AgentResult):
            live_data.update(agent_result.live_data or {})

    history = ""
    for turn in state.get("conversation_history", []):
        role    = turn.get("role", "")
        content = turn.get("content", "")[:400]
        history += f"{role.upper()}: {content}\n\n"

    final_context = build_context(
        chunks=state.get("all_chunks", []),
        live_data=live_data,
        history=history.strip(),
    )

    return {"final_context": final_context}


# ── Compiled graph ─────────────────────────────────────────────────────────────

def _build_graph() -> StateGraph:
    g = StateGraph(CopilotState)
    g.add_node("supervisor_node",         supervisor_node)
    g.add_node("parallel_dispatch_node",  parallel_dispatch_node)
    g.add_node("merge_node",              merge_node)
    g.add_node("context_builder_node",    context_builder_node)

    g.add_edge(START,                    "supervisor_node")
    g.add_edge("supervisor_node",        "parallel_dispatch_node")
    g.add_edge("parallel_dispatch_node", "merge_node")
    g.add_edge("merge_node",             "context_builder_node")
    g.add_edge("context_builder_node",   END)
    return g


_compiled_graph = None


def get_compiled_graph():
    """Lazy-compile the LangGraph graph once."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = _build_graph().compile()
    return _compiled_graph
