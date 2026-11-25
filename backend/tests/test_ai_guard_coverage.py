"""Guard-coverage test: no paid AI client may be constructed (or a paid AI HTTP
endpoint called) outside the guarded modules.

If this fails you added a new LLM / embedding / image / voice call site.  Route
it through app.services.agentic.bedrock_client (get_llm_sonnet / get_llm_haiku /
get_llm_anthropic / embed_* / rerank), fal_service._generate or
tts_service.synthesize — or reserve budget with app.services.ai_guard and add
the file here with a comment explaining how it is guarded.
"""
from __future__ import annotations

import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent

# Constructors / endpoints of paid AI providers.
PATTERNS = [
    r"\bChatAnthropic\s*\(", r"\bChatBedrock(Converse)?\s*\(", r"\bChatOpenAI\s*\(",
    r"\bAzureChatOpenAI\s*\(", r"\bChatGroq\s*\(", r"\bBedrockEmbeddings\s*\(", r"\bOpenAIEmbeddings\s*\(",
    r"\b(Async)?Anthropic\s*\(", r"\b(Async)?OpenAI\s*\(", r"\bcohere\.(Client|ClientV2|AsyncClient)\s*\(",
    r"\bElevenLabs\s*\(", r"\binvoke_model(_with_response_stream)?\s*\(", r"\.converse(_stream)?\s*\(",
    r"fal\.run", r"queue\.fal\.run", r"api\.groq\.com", r"openrouter\.ai/api",
    r"api\.elevenlabs\.io", r"api\.openai\.com", r"api\.anthropic\.com", r"api\.cohere\.(ai|com)",
    r"api\.x\.ai", r"bytez",
]

# file (relative to backend/) → how it is guarded
ALLOWED_BACKEND = {
    "app/services/agentic/bedrock_client.py": "guarded factories (GuardCallbackHandler) + guarded embed/rerank",
    "app/services/fal_service.py": "_generate → ai_guard.reserve (images / og_images)",
    "app/services/tts_service.py": "synthesize → ai_guard.reserve (tts_chars)",
    "app/services/threat_classification.py": "Groq call gated by ai_guard.reserve_system",
}
# Another agent owns this package (PR #72); it must use reserve_system / the factories.
EXCLUDED_DIRS: tuple = ()

ALLOWED_FRONTEND = {
    # Each relay calls the backend /api/v1/ai-usage/reserve before spending.
    "frontend/src/app/api/ai-analysis/route.ts": "OpenRouter relay; backend reserve first",
}


def _scan(root: Path, suffixes: tuple[str, ...]):
    rx = re.compile("|".join(PATTERNS))
    for path in root.rglob("*"):
        if path.suffix not in suffixes or "__pycache__" in path.parts or "node_modules" in path.parts:
            continue
        rel = path.relative_to(REPO if root.is_relative_to(REPO / "frontend") else BACKEND).as_posix()
        for n, line in enumerate(path.read_text(errors="ignore").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith(("#", "//", "*")):
                continue
            if rx.search(line):
                yield rel, n, stripped


def test_no_unguarded_ai_clients_in_backend():
    offenders = [
        f"{rel}:{n}: {line}"
        for root in (BACKEND / "app", BACKEND / "scripts")
        if root.exists()
        for rel, n, line in _scan(root, (".py",))
        if rel not in ALLOWED_BACKEND and not rel.startswith(EXCLUDED_DIRS)
    ]
    assert not offenders, "Unguarded paid-AI call sites:\n" + "\n".join(offenders)


def test_no_unguarded_ai_calls_in_frontend():
    src = REPO / "frontend" / "src"
    if not src.exists():
        return
    offenders = [
        f"{rel}:{n}: {line}"
        for rel, n, line in _scan(src, (".ts", ".tsx", ".js"))
        if rel not in ALLOWED_FRONTEND and not rel.endswith((".test.ts", ".test.tsx"))
    ]
    assert not offenders, "Frontend must not call paid AI providers directly:\n" + "\n".join(offenders)


def test_allowlisted_relays_reserve_quota_first():
    for rel in ALLOWED_FRONTEND:
        p = REPO / rel
        if p.exists():
            assert "reserveAiQuota" in p.read_text(), f"{rel} must call reserveAiQuota() before the provider"


def test_guarded_modules_actually_reference_the_guard():
    for rel in ALLOWED_BACKEND:
        text = (BACKEND / rel).read_text()
        assert "ai_guard" in text or "GuardCallbackHandler" in text, f"{rel} is allowlisted but not guarded"
