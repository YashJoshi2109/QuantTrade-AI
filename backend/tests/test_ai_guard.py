"""AI usage guard (app.services.ai_guard): limits, breaker, accounting, providers.

No real provider is ever called: LLMs are fake LangChain chat models with fake
usage metadata, HTTP providers (fal, ElevenLabs) are patched httpx clients.
The root conftest gives every test a fresh in-memory guard store.
"""
from __future__ import annotations

import asyncio
import contextlib
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services import ai_guard
from app.services.ai_guard import AIQuotaError, BUDGET_PAUSED_DETAIL, GuardContext

SONNET = "anthropic.claude-sonnet-4-6"
HAIKU = "anthropic.claude-haiku-4-5-20251001-v1:0"


@pytest.fixture
def events():
    out: list = []
    ai_guard.set_persist_sink(out.append)
    return out


@pytest.fixture
def env(monkeypatch):
    for k, v in {
        "LLM_FREE_REQ_PER_MIN": "100",
        "LLM_FREE_REQ_PER_DAY": "100",
        "AI_IP_REQ_PER_DAY": "1000",
    }.items():
        monkeypatch.setenv(k, v)
    return monkeypatch


def _user(uid=1, tier="free", ip="10.0.0.1", feature="copilot"):
    return GuardContext(feature=feature, user_id=uid, tier=tier, ip=ip)


class FakeChat(BaseChatModel):
    """Chat model returning fixed usage metadata; streams `n_chunks` x 'abcd'."""
    n_chunks: int = 50
    in_tok: int = 100
    out_tok: int = 20

    @property
    def _llm_type(self):
        return "fake"

    def _generate(self, messages, stop=None, run_manager=None, **kw):
        msg = AIMessage(content="ok", usage_metadata={
            "input_tokens": self.in_tok, "output_tokens": self.out_tok,
            "total_tokens": self.in_tok + self.out_tok})
        return ChatResult(generations=[ChatGeneration(message=msg)])

    async def _astream(self, messages, stop=None, run_manager=None, **kw):
        for _ in range(self.n_chunks):
            ch = ChatGenerationChunk(message=AIMessageChunk(content="abcd"))
            if run_manager:
                await run_manager.on_llm_new_token("abcd", chunk=ch)
            yield ch


def _guarded(model=SONNET, max_tokens=100, ctx=None, **kw):
    return FakeChat(callbacks=[ai_guard.GuardCallbackHandler("bedrock", model, max_tokens, ctx=ctx)], **kw)


# ── Per-user / per-IP limits ────────────────────────────────────────────────

def test_per_minute_burst_limit(monkeypatch):
    monkeypatch.setenv("LLM_FREE_REQ_PER_MIN", "3")
    ctx = _user()
    for _ in range(3):
        ai_guard.admit_request(ctx)
    with pytest.raises(AIQuotaError) as e:
        ai_guard.admit_request(ctx)
    assert e.value.status_code == 429 and e.value.reason == "rpm"


def test_per_day_request_limit_by_tier(env):
    env.setenv("LLM_FREE_REQ_PER_DAY", "2")
    env.setenv("LLM_PRO_REQ_PER_DAY", "4")
    free, pro = _user(1), _user(2, tier="pro")
    for _ in range(2):
        ai_guard.admit_request(free)
    with pytest.raises(AIQuotaError) as e:
        ai_guard.admit_request(free)
    assert e.value.reason == "req_day"
    for _ in range(4):
        ai_guard.admit_request(pro)
    with pytest.raises(AIQuotaError):
        ai_guard.admit_request(pro)


def test_tokens_per_day_limit(env):
    env.setenv("LLM_FREE_TOKENS_PER_DAY", "1000")
    ctx = _user()
    res = ai_guard.reserve("bedrock", HAIKU, est_input_tokens=300, est_output_tokens=300, ctx=ctx)
    res.commit(300, 300)
    with pytest.raises(AIQuotaError) as e:
        ai_guard.reserve("bedrock", HAIKU, est_input_tokens=300, est_output_tokens=300, ctx=ctx)
    assert e.value.status_code == 429 and e.value.reason == "tokens_day"


def test_ip_daily_cap_across_accounts(env):
    env.setenv("AI_IP_REQ_PER_DAY", "3")
    for uid in (1, 2, 3):
        ai_guard.admit_request(_user(uid, ip="203.0.113.9"))
    with pytest.raises(AIQuotaError) as e:
        ai_guard.admit_request(_user(4, ip="203.0.113.9"))
    assert e.value.reason == "ip_day"
    ai_guard.admit_request(_user(5, ip="198.51.100.1"))  # other networks unaffected


def test_repeated_denials_are_logged_without_pii(monkeypatch, caplog):
    monkeypatch.setenv("LLM_FREE_REQ_PER_MIN", "1")
    ctx = _user(uid=42, ip="203.0.113.77")
    ai_guard.admit_request(ctx)
    with caplog.at_level("WARNING", logger="ai_guard"):
        for _ in range(5):
            with pytest.raises(AIQuotaError):
                ai_guard.admit_request(ctx)
    msgs = [r.getMessage() for r in caplog.records if "abuse" in r.getMessage()]
    assert msgs and "user_id=42" in msgs[0]
    assert "203.0.113.77" not in " ".join(r.getMessage() for r in caplog.records)


# ── Global circuit breaker ──────────────────────────────────────────────────

def test_global_daily_budget_returns_503_with_message(env, events):
    env.setenv("LLM_DAILY_BUDGET_USD", "0.01")
    ctx = _user()
    # Sonnet 1000 in / 1000 out = $0.018 > $0.01 budget
    with pytest.raises(AIQuotaError) as e:
        ai_guard.reserve("bedrock", SONNET, est_input_tokens=1000, est_output_tokens=1000, ctx=ctx)
    assert e.value.status_code == 503
    assert e.value.detail == BUDGET_PAUSED_DETAIL
    # spend up to the budget, then even admission is refused
    ai_guard.reserve("bedrock", HAIKU, est_input_tokens=1000, est_output_tokens=1800, ctx=ctx).commit(1000, 1800)
    with pytest.raises(AIQuotaError) as e:
        ai_guard.admit_request(ctx)
    assert e.value.status_code == 503 and e.value.reason == "global_day"


def test_global_hourly_budget(env):
    env.setenv("LLM_HOURLY_BUDGET_USD", "0.005")
    ai_guard.reserve("bedrock", HAIKU, est_input_tokens=1000, est_output_tokens=800, ctx=_user()).commit(1000, 800)
    assert ai_guard.budget_paused() == "global_hour"
    with pytest.raises(AIQuotaError) as e:
        ai_guard.admit_request(_user(2))
    assert e.value.status_code == 503


def test_per_provider_daily_budget(env):
    env.setenv("AI_DAILY_BUDGET_USD_OPENAI", "0.001")
    with pytest.raises(AIQuotaError) as e:
        ai_guard.reserve("openai", "gpt-4o", est_input_tokens=1000, est_output_tokens=1000, ctx=_user())
    assert e.value.reason == "provider_day" and e.value.status_code == 503
    ai_guard.reserve("bedrock", HAIKU, est_input_tokens=100, est_output_tokens=100, ctx=_user())  # other providers fine


def test_system_budget_is_separate(env):
    env.setenv("LLM_SYSTEM_DAILY_BUDGET_USD", "0.002")
    res = ai_guard.reserve_system("news_notes", est_tokens=1000)
    res.commit(700, 300)
    with pytest.raises(AIQuotaError) as e:
        ai_guard.reserve_system("news_notes", est_tokens=1000)
    assert e.value.reason == "system_day"
    ai_guard.admit_request(_user())  # user features unaffected by the system cap


def test_unattributed_call_is_charged_to_system_budget(env):
    env.setenv("LLM_SYSTEM_DAILY_BUDGET_USD", "0.0001")
    with pytest.raises(AIQuotaError):
        _guarded(ctx=None).invoke("hi")  # no context bound anywhere


# ── Reserve / reconcile accounting ──────────────────────────────────────────

def test_reserve_then_reconcile_uses_actual_usage(events):
    ctx = _user()
    res = ai_guard.reserve("bedrock", SONNET, est_input_tokens=2000, est_output_tokens=2000, ctx=ctx)
    assert ai_guard.global_summary()["today_spent_usd"] == pytest.approx(0.036, abs=1e-6)
    cost = res.commit(input_tokens=100, output_tokens=50)
    assert cost == pytest.approx(100 / 1e6 * 3 + 50 / 1e6 * 15)
    g = ai_guard.global_summary()
    assert g["today_spent_usd"] == pytest.approx(cost, abs=1e-4)  # summary rounds to 4dp
    assert g["providers"]["bedrock"]["spent_usd"] == pytest.approx(cost, abs=1e-4)
    u = ai_guard.usage_summary(1, "free")
    assert u["tokens_used"] == 150 and u["input_tokens"] == 100 and u["output_tokens"] == 50
    assert events[-1]["provider"] == "bedrock" and events[-1]["input_tokens"] == 100
    assert events[-1]["user_id"] == 1 and events[-1]["feature"] == "copilot"


def test_release_refunds_failed_call():
    res = ai_guard.reserve("bedrock", SONNET, est_input_tokens=2000, est_output_tokens=2000, ctx=_user())
    res.release()
    assert ai_guard.global_summary()["today_spent_usd"] == 0
    assert ai_guard.usage_summary(1, "free")["tokens_used"] == 0


def test_langchain_callback_reconciles_from_usage_metadata(events):
    llm = _guarded(ctx=_user(feature="hyde"), in_tok=321, out_tok=45)
    assert llm.invoke("hello").content == "ok"
    ev = events[-1]
    assert (ev["input_tokens"], ev["output_tokens"], ev["feature"]) == (321, 45, "hyde")
    assert ev["cost_usd"] == pytest.approx(321 / 1e6 * 3 + 45 / 1e6 * 15, abs=1e-6)


def test_callback_refuses_call_when_budget_exhausted(env):
    env.setenv("LLM_DAILY_BUDGET_USD", "0.000001")
    with pytest.raises(AIQuotaError):
        _guarded(ctx=_user()).invoke("hello")


def test_usage_extraction_variants():
    msg = AIMessage(content="x", response_metadata={"token_usage": {"prompt_tokens": 7, "completion_tokens": 3}})
    assert ai_guard.usage_from_langchain(msg) == (7, 3)
    resp = SimpleNamespace(usage=SimpleNamespace(input_tokens=11, output_tokens=2))
    assert ai_guard.usage_from_anthropic(resp) == (11, 2)


# ── Streaming cutoff ────────────────────────────────────────────────────────

def test_streaming_cut_off_at_cap_and_still_counted(events):
    llm = _guarded(ctx=_user(), max_tokens=10, n_chunks=500)

    async def run():
        meter = ai_guard.StreamMeter(10)
        out = ""
        async with contextlib.aclosing(llm.astream("hi")) as s:
            async for c in s:
                out += c.content
                if not meter.add(c.content):
                    break
        return out, meter

    out, meter = asyncio.run(run())
    assert meter.cut and len(out) == 40  # 10 tokens * 4 chars
    assert events and events[-1]["status"] == "partial" and events[-1]["output_tokens"] == 10


# ── Fail closed without Redis ───────────────────────────────────────────────

class _BrokenRedis:
    def register_script(self, _src):
        def _call(*a, **k):
            raise ConnectionError("redis down")
        return _call

    def mget(self, *_a, **_k):
        raise ConnectionError("redis down")

    def pipeline(self):
        raise ConnectionError("redis down")


def test_fails_closed_to_scaled_in_process_limiter(monkeypatch):
    monkeypatch.setenv("LLM_FREE_REQ_PER_MIN", "4")
    monkeypatch.setattr(ai_guard, "_fallback_store", ai_guard._FallbackStore())
    monkeypatch.setattr(ai_guard, "_redis_down_until", 0.0)
    ai_guard.set_store(ai_guard.RedisStore(_BrokenRedis()))
    ctx = _user()
    ai_guard.admit_request(ctx)
    ai_guard.admit_request(ctx)  # fallback limit = 4 * 0.5 = 2
    with pytest.raises(AIQuotaError) as e:
        ai_guard.admit_request(ctx)
    assert e.value.reason == "rpm"


# ── HTTP layer: anonymous / unverified rejected, 503 surfaced ───────────────

@pytest.fixture
def http(monkeypatch, env):
    from app.api import ai_quota
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.billing import Subscription
    from app.models.user import User

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[User.__table__, Subscription.__table__])
    SL = sessionmaker(bind=engine)
    db = SL()
    db.add_all([
        User(id=1, email="v@example.com", username="v", is_verified=True),
        User(id=2, email="u@example.com", username="u", is_verified=False),
    ])
    db.commit()
    db.close()

    app = FastAPI()
    app.include_router(ai_quota.router, prefix="/api/v1")

    @app.post("/llm")
    def llm_endpoint(ctx: GuardContext = Depends(ai_quota.require_llm_quota("copilot"))):
        return {"tier": ctx.tier}

    def _db():
        s = SL()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    client = TestClient(app)
    client.tok = lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"}
    return client


def test_anonymous_and_unverified_get_no_llm(http):
    assert http.post("/llm").status_code == 401
    r = http.post("/llm", headers=http.tok(2))
    assert r.status_code == 403 and "Verify" in r.json()["detail"]
    assert http.post("/llm", headers=http.tok(1)).json() == {"tier": "free"}


def test_budget_paused_returns_503_detail(http, env):
    env.setenv("LLM_DAILY_BUDGET_USD", "0.000001")
    ai_guard._store().incr(ai_guard._k("g", "cost", ai_guard._day()), 10, 3600)
    r = http.post("/llm", headers=http.tok(1))
    assert r.status_code == 503
    assert r.json() == {"detail": "AI features are paused for today (budget reached)."}
    u = http.get("/api/v1/me/ai-usage", headers=http.tok(1)).json()
    assert u["paused"] is True


def test_me_ai_usage_reports_remaining(http, env):
    env.setenv("LLM_FREE_REQ_PER_DAY", "20")
    http.post("/llm", headers=http.tok(1))
    u = http.get("/api/v1/me/ai-usage", headers=http.tok(1)).json()
    assert u["requests_used"] == 1 and u["requests_remaining"] == 19 and u["tier"] == "free"
    assert http.get("/api/v1/me/ai-usage").status_code == 401


def test_admin_usage_requires_admin(http):
    assert http.get("/api/v1/admin/llm-usage", headers=http.tok(1)).status_code == 403


def test_relay_reserve_charges_worst_case_and_validates(http, events):
    bad = http.post("/api/v1/ai-usage/reserve", headers=http.tok(1),
                    json={"feature": "copilot_relay", "model": "gpt-5", "input_chars": 10, "max_tokens": 10})
    assert bad.status_code == 400
    ok = http.post("/api/v1/ai-usage/reserve", headers=http.tok(1),
                   json={"feature": "copilot_relay", "model": "llama-3.3-70b-versatile",
                         "input_chars": 4000, "max_tokens": 8000})
    assert ok.status_code == 200 and ok.json()["max_tokens"] == 2048
    assert events[-1]["provider"] == "groq" and events[-1]["output_tokens"] == 2048
    assert http.post("/api/v1/ai-usage/reserve",
                     json={"feature": "ai_analysis", "model": "google/gemini-flash-1.5-8b",
                           "input_chars": 10, "max_tokens": 10}).status_code == 401


# ── Provider-specific guards ─────────────────────────────────────────────────

def test_anthropic_direct_factory_is_capped_and_guarded(monkeypatch):
    from app.config import settings
    from app.services.agentic import bedrock_client as bc
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    llm = bc.get_llm_anthropic(max_tokens=99_999)
    assert llm.max_tokens == 1024
    assert any(isinstance(cb, ai_guard.GuardCallbackHandler) for cb in llm.callbacks)


def test_openai_and_openrouter_factories_are_guarded(monkeypatch):
    from app.services.agentic import bedrock_client as bc
    monkeypatch.setattr(bc, "_aws_credentials_available", lambda: False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    llm = bc.get_llm_sonnet(streaming=False)
    assert llm.max_tokens == 2048
    assert any(isinstance(cb, ai_guard.GuardCallbackHandler) and cb.provider == "openai" for cb in llm.callbacks)
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test")
    llm = bc.get_llm_haiku(max_tokens=5000)
    assert llm.max_tokens == 1024
    assert any(getattr(cb, "provider", None) == "openrouter" for cb in llm.callbacks)


def test_embeddings_capped_cached_and_counted(monkeypatch, events):
    from app.services.agentic import bedrock_client as bc

    calls = []

    class FakeEmb:
        def embed_documents(self, texts):
            calls.append(list(texts))
            return [[float(len(t))] for t in texts]

        def embed_query(self, text):
            calls.append([text])
            return [float(len(text))]

    fake = FakeEmb()
    monkeypatch.setattr(bc, "_embedder_cache", fake)
    monkeypatch.setitem(bc._EMBED_PROVIDER, id(fake), ("bedrock", bc.BEDROCK_TITAN_MODEL))
    monkeypatch.setenv("AI_EMBED_MAX_CHARS", "100")
    with ai_guard.use_context(_user(feature="copilot")):
        v1 = bc.embed_query("x" * 500)
        v2 = bc.embed_query("x" * 500)  # identical → cache, no second call
    assert v1 == v2 == [100.0] and len(calls) == 1
    assert events[-1]["provider"] == "bedrock" and events[-1]["input_tokens"] == 25
    monkeypatch.setenv("AI_EMBED_TOKENS_PER_DAY", "10")
    with pytest.raises(AIQuotaError):
        bc.embed_texts(["y" * 100])


def test_openai_embedding_service_guarded(monkeypatch, events):
    from app.services.embedding_service import EmbeddingService

    class FakeClient:
        n = 0

        class embeddings:  # noqa: N801
            @staticmethod
            def create(model, input):
                FakeClient.n += 1
                return SimpleNamespace(data=[SimpleNamespace(embedding=[0.5]) for _ in input],
                                       usage=SimpleNamespace(prompt_tokens=9))

    svc = EmbeddingService(use_openai=True)
    svc._openai_client = FakeClient()
    assert svc.embed_text("hello world") == [0.5]
    assert svc.embed_text("hello world") == [0.5]
    assert FakeClient.n == 1 and events[-1]["provider"] == "openai" and events[-1]["input_tokens"] == 9


def test_cohere_rerank_counted_per_call(monkeypatch, events):
    from app.services.agentic import bedrock_client as bc

    class FakeCohere:
        def rerank(self, **kw):
            assert len(kw["documents"]) <= 100
            return SimpleNamespace(results=[SimpleNamespace(index=0, relevance_score=0.9)])

    monkeypatch.setattr(bc, "_cohere_client", lambda: FakeCohere())
    with ai_guard.use_context(_user()):
        assert bc.rerank("q", ["d"] * 150, top_n=1) == [{"index": 0, "score": 0.9}]
    assert events[-1]["provider"] == "cohere" and events[-1]["cost_usd"] == pytest.approx(0.002)
    monkeypatch.setenv("AI_DAILY_BUDGET_USD_COHERE", "0.003")
    with pytest.raises(AIQuotaError):
        bc.rerank("q", ["d"], top_n=1)


class _FakeAsyncHTTP:
    calls = 0

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        _FakeAsyncHTTP.calls += 1
        return SimpleNamespace(status_code=200, json=lambda: {"images": [{"url": f"https://img/{_FakeAsyncHTTP.calls}"}]},
                               text="")


@pytest.fixture
def fal(monkeypatch):
    from app.config import settings
    from app.services import fal_service
    monkeypatch.setattr(settings, "FAL_API_KEY", "fal-test")
    _FakeAsyncHTTP.calls = 0
    monkeypatch.setattr(fal_service.httpx, "AsyncClient", _FakeAsyncHTTP)
    return fal_service


def test_fal_images_per_day_cached_and_priced(fal, env, events):
    env.setenv("AI_FREE_IMAGES_PER_DAY", "2")
    with ai_guard.use_context(_user(feature="image_generation")):
        u1 = asyncio.run(fal.generate_image("a castle", width=1000, height=1000))
        u1b = asyncio.run(fal.generate_image("a castle", width=1000, height=1000))  # cached
        asyncio.run(fal.generate_image("a bridge", width=1000, height=1000))
        with pytest.raises(AIQuotaError) as e:
            asyncio.run(fal.generate_image("a tower", width=5000, height=5000))
    assert u1 == u1b and _FakeAsyncHTTP.calls == 2
    assert e.value.reason == "images_day"
    assert events[-1]["provider"] == "fal" and events[-1]["cost_usd"] == pytest.approx(0.003)


def test_og_image_cached_once_and_falls_back_at_global_cap(fal, env):
    from app.api import ai_image
    env.setenv("AI_OG_IMAGES_PER_DAY", "1")
    app = FastAPI()
    app.include_router(ai_image.router, prefix="/api/v1/ai-image")
    c = TestClient(app)
    a = c.get("/api/v1/ai-image/og", params={"title": "AAPL", "type": "stock"}).json()
    b = c.get("/api/v1/ai-image/og", params={"title": "AAPL", "type": "stock"}).json()
    assert a["url"] and b == {"url": a["url"], "cached": True}
    capped = c.get("/api/v1/ai-image/og", params={"title": "MSFT", "type": "stock"}).json()
    assert capped["url"] is None and capped["fallback"] is True
    assert _FakeAsyncHTTP.calls == 1


def test_image_endpoints_require_auth(fal):
    from app.api import ai_image
    app = FastAPI()
    app.include_router(ai_image.router, prefix="/api/v1/ai-image")
    c = TestClient(app)
    assert c.post("/api/v1/ai-image/generate", json={"prompt": "x"}).status_code == 401
    assert c.post("/api/v1/ai-image/stock-visual", json={"symbol": "A", "company_name": "A"}).status_code == 401
    assert c.post("/api/v1/ai-image/game-asset", json={"asset_type": "item", "name": "x"}).status_code == 401


class _FakeSyncHTTP:
    calls: list = []

    def __init__(self, *a, **k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def post(self, url, params=None, json=None, headers=None):
        _FakeSyncHTTP.calls.append(json["text"])
        return SimpleNamespace(status_code=200, content=b"MP3" + json["text"].encode(), text="")


def test_elevenlabs_chars_capped_cached_and_daily_limit(monkeypatch, env, events):
    from app.config import settings
    from app.services import tts_service
    monkeypatch.setattr(settings, "ELEVENLABS_API_KEY", "el-test")
    monkeypatch.setattr(tts_service.httpx, "Client", _FakeSyncHTTP)
    _FakeSyncHTTP.calls = []
    env.setenv("AI_TTS_MAX_CHARS_PER_REQUEST", "50")
    env.setenv("AI_FREE_TTS_CHARS_PER_DAY", "120")
    with ai_guard.use_context(_user(feature="game_voice")):
        a = tts_service.synthesize("x" * 80, "voice1")
        b = tts_service.synthesize("x" * 80, "voice1")  # cached
        tts_service.synthesize("y" * 50, "voice1")
        with pytest.raises(AIQuotaError) as e:
            tts_service.synthesize("z" * 50, "voice1")
    assert a == b and len(_FakeSyncHTTP.calls) == 2 and len(_FakeSyncHTTP.calls[0]) == 50
    assert e.value.reason == "tts_day"
    assert events[-1]["provider"] == "elevenlabs" and events[-1]["units"] == 50
    assert events[-1]["cost_usd"] == pytest.approx(50 * 0.0003)


def test_voice_endpoints_require_auth():
    from app.api import game, voice
    app = FastAPI()
    app.include_router(voice.router, prefix="/api/v1/voice")
    app.include_router(game.router, prefix="/api/v1/game")
    c = TestClient(app)
    assert c.post("/api/v1/voice/generate", json={"text": "hi"}).status_code == 401
    assert c.post("/api/v1/game/audio/voiceover", json={"text": "hi", "role": "narrator"}).status_code == 401


def test_sec_insights_cached_so_refresh_does_not_rebill(monkeypatch, events):
    from app.services import sec_edgar_service as sec
    from app.services.agentic import bedrock_client as bc

    built = []

    def fake_factory(**kw):
        built.append(1)
        return _guarded(model="claude-haiku-4-5-20251001")

    monkeypatch.setattr(bc, "get_llm_anthropic", fake_factory)
    admitted = []
    fin = [{"period": "2025-FY", "period_end_date": "2025-12-31", "revenue": '{"value": 1000000000}'}]
    with ai_guard.use_context(_user(feature="sec_insights")):
        t1 = asyncio.run(sec.generate_filing_insights("ZZZ", fin, [], {"company_name": "Z"},
                                                      before_llm=lambda: admitted.append(1) or True))
        t2 = asyncio.run(sec.generate_filing_insights("ZZZ", fin, [], {"company_name": "Z"},
                                                      before_llm=lambda: admitted.append(1) or True))
    assert t1 == t2 == "ok"
    assert len(admitted) == 1 and len([e for e in events if e["feature"] == "sec_insights"]) == 1
    # anonymous cache miss → rule-based fallback, no model call
    t3 = asyncio.run(sec.generate_filing_insights("YYY", fin, [], {"company_name": "Y"}, before_llm=lambda: False))
    assert "YYY" in t3 and len(events) == 1


def test_moderation_charged_to_system_budget(monkeypatch, events):
    from app.services import moderation_service as mod
    from app.services.agentic import bedrock_client as bc

    class JsonChat(FakeChat):
        def _generate(self, messages, stop=None, run_manager=None, **kw):
            msg = AIMessage(content='{"score": 0.1}', usage_metadata={
                "input_tokens": 50, "output_tokens": 5, "total_tokens": 55})
            return ChatResult(generations=[ChatGeneration(message=msg)])

    def factory(**kw):
        return JsonChat(callbacks=[ai_guard.GuardCallbackHandler(
            "anthropic", "claude-haiku-4-5", 512, ctx=ai_guard.current_context())])

    monkeypatch.setattr(bc, "get_llm_anthropic", factory)
    out = asyncio.run(mod.moderation_service._ai_analyze("hello"))
    assert out == {"score": 0.1}
    assert events[-1]["is_system"] is True and events[-1]["feature"] == "moderation"
