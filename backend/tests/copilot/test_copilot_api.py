"""/api/v1/copilot/stream over HTTP: auth + quota gate, SSE framing, history persistence."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def client(monkeypatch):
    from app.api import copilot as copilot_api
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.billing import Subscription
    from app.models.chat_history import ChatHistory, Conversation
    from app.models.user import User
    from app.services.copilot import engine as engine_mod
    from app.services.copilot.evalkit import FixtureSources, ScriptedLLM, fixture_db
    from app.services.copilot.memory import InMemoryStore

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[User.__table__, Subscription.__table__,
                                               Conversation.__table__, ChatHistory.__table__])
    SL = sessionmaker(bind=eng)
    s = SL()
    s.add(User(id=1, email="v@example.com", username="v", is_verified=True))
    s.commit()
    s.close()
    sym_db = fixture_db()

    real = engine_mod.CopilotEngine

    def fake_engine(db):
        llm = ScriptedLLM([{"text": "NVIDIA is at $181.20 [quote:NVDA] [bogus:id]."}])
        return real(sym_db, sources=FixtureSources(),
                    llm_chain=[engine_mod.LLMHandle("scripted", "scripted-model", lambda: llm)],
                    memory_store=InMemoryStore(), use_pack_cache=False)

    monkeypatch.setattr(engine_mod, "CopilotEngine", fake_engine)
    monkeypatch.setattr("app.services.copilot.viewed.record_view", lambda t: None)

    app = FastAPI()
    app.include_router(copilot_api.router, prefix="/api/v1")

    def _db():
        d = SL()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    c.tok = {"Authorization": f"Bearer {create_access_token(1)}"}
    c.SL = SL
    return c


def _events(body: str):
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(l.split(": ", 1) for l in block.splitlines() if ": " in l)
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def test_requires_auth(client):
    assert client.post("/api/v1/copilot/stream", json={"message": "hi"}).status_code == 401


def test_stream_sse_contract_and_history(client):
    r = client.post("/api/v1/copilot/stream", json={"message": "NVDA price?", "conversation_id": "c-1"},
                    headers=client.tok)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    evs = _events(r.text)
    names = [n for n, _ in evs]
    assert names[:2] == ["intent", "context"] and "token" in names and names[-1] == "done"
    done = evs[-1][1]
    assert done["postcheck"]["invalid_citations"] == ["bogus:id"]
    assert "[bogus:id]" not in done["final_text"]            # client replaces streamed text
    assert done["model"] == "scripted-model" and "guard" in done
    assert [c["id"] for c in done["citations"]] == ["quote:NVDA"]
    from app.models.chat_history import ChatHistory
    s = client.SL()
    rows = s.query(ChatHistory).filter(ChatHistory.conversation_id == "c-1").all()
    assert {r.role for r in rows} == {"user", "assistant"}
    assert all("bogus" not in r.content for r in rows)
    s.close()


def test_message_too_long(client):
    r = client.post("/api/v1/copilot/stream", json={"message": "x" * 10_000}, headers=client.tok)
    assert r.status_code == 413
