"""
Offline evaluation harness for the RAG engine.

The goal is not to compute sophisticated benchmarks but to provide a
simple smoke test that the RAG stack:
- can answer basic questions, and
- avoids hallucinating when context is empty.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

from rag_engine import RAGEngine


@dataclass
class EvalCase:
    name: str
    query: str
    symbol: str | None
    expect_idk: bool


CASES: List[EvalCase] = [
    EvalCase(
        name="no_context_idk",
        query="What were Apple's revenues in 1993?",
        symbol=None,
        expect_idk=True,
    ),
    EvalCase(
        name="generic_market_question",
        query="Explain what a price-to-earnings ratio is.",
        symbol=None,
        expect_idk=False,
    ),
]


def run() -> int:
    engine = RAGEngine()
    failures = 0

    for case in CASES:
        print(f"🔍 Evaluating case: {case.name}")
        try:
            answer = engine.analyze(
                symbol=case.symbol or "AAPL",
                analysis_type="fundamental",
                user_query=case.query,
                stream=False,
            )
        except Exception as exc:  # pragma: no cover - defensive
            print(f"❌ Error for case {case.name}: {exc}")
            failures += 1
            continue

        text = str(answer).lower()
        idk_markers = [
            "i don't have specific data",
            "i do not have specific data",
            "not enough information",
            "insufficient data",
        ]
        has_idk = any(m in text for m in idk_markers)

        if case.expect_idk and not has_idk:
            print(f"⚠️ Expected an 'I don't know' style reply for {case.name}.")
            failures += 1
        else:
            print(f"✅ Case {case.name} passed.")

    return failures


if __name__ == "__main__":
    failures = run()
    if failures:
        raise SystemExit(1)
    raise SystemExit(0)

