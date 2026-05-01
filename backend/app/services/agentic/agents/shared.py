"""Shared types for agent functions."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.agentic.retrieval.parent_child import ChunkWithCitation


@dataclass
class AgentResult:
    chunks:    list[ChunkWithCitation] = field(default_factory=list)
    live_data: dict[str, Any]          = field(default_factory=dict)
    error:     str | None              = None
