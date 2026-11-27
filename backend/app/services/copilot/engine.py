"""Copilot request pipeline.

  resolve tickers (server-side; UI symbol wins)
    -> refusal gates (off-topic / unknown ticker / no data) — no LLM call
    -> TickerContextPacks in parallel (per-source timeouts, 60s cache)   => SSE `context`
    -> deep questions only: planner (capabilities -> tools discovered from
       the registry) + parallel prefetch with per-call timeouts             => SSE `plan`, `progress`, `tool`
    -> Claude tool-use loop (<= MAX_TOOL_ROUNDS, deep: DEEP_MAX_TOOL_ROUNDS
       and a DEEP_MAX_TOOL_CALLS budget), streamed                          => SSE `tool`, `token`
    -> post-checks: citation ids, numeric grounding, policy                => SSE `citation`, `done`
       deep: one grounding/structure repair round, then composer.finalize
       (untraceable figures blocked, required sections, server-rendered Sources)

Events are (name, payload) tuples; the API layer turns them into SSE.  The
data sources, the LLM chain and the memory store are injected so the eval
harness can run the exact same code offline with fixtures + a scripted model.
"""
from __future__ import annotations

import asyncio
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Dict, List, Optional, Sequence, Tuple

from app.services.copilot import composer, planner
from app.services.copilot.context_pack import build_pack
from app.services.copilot.memory import ConversationMemory, InMemoryStore
from app.services.copilot.models import TickerContextPack
from app.services.copilot.postcheck import run_postcheck
from app.services.copilot.prompt import (cache_call_kwargs, history_messages, prompt_cache_enabled,
                                         system_message, system_prompt, user_turn)
from app.services.copilot.registry import FactRegistry, numbers_in_text
from app.services.copilot.resolver import Resolution, TickerResolver
from app.services.copilot.telemetry import Trace
from app.services.copilot import llm_stats
from app.services.copilot.tools import ToolExecutor, context_block, lc_tools

import logging
import os

logger = logging.getLogger(__name__)
# Models that rejected prompt-cache breakpoints (process lifetime).
_CACHE_REJECTED: set = set()

MAX_TOOL_ROUNDS = int(os.getenv("COPILOT_MAX_TOOL_ROUNDS", "4"))
GROUNDING_REPAIR = os.getenv("COPILOT_GROUNDING_REPAIR", "1").lower() not in ("0", "false", "no")
DISCLAIMER = "\n\n*Informational only, not financial advice.*"
OFF_TOPIC_REPLY = ("I'm QuantTrade's markets copilot, so I can only help with stocks, ETFs, "
                   "company financials and the economy. Try asking about a ticker.")

NEEDS_FILINGS = re.compile(
    r"\b(risk|risks|10-?k|10-?q|8-?k|filing|filings|guidance|guide[ds]?|segment|customer|customers|"
    r"concentration|business model|competition|competitor|litigation|lawsuit|md&a|capex|capital expenditure|"
    r"outlook|product|products|disclos\w*|supplier|exposure|sensitivity|strategy|management said|"
    r"rate sensitivity|net interest)\b", re.I)

Event = Tuple[str, Dict[str, Any]]


@dataclass
class CopilotRequest:
    message: str
    user_id: int
    symbol: Optional[str] = None
    conversation_id: Optional[str] = None
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    # evaluation run (scripts/run_institutional_eval.py --live): every AI call is
    # charged to the eval budget only (ai_guard LLM_EVAL_DAILY_BUDGET_USD), never
    # to the system or user budgets. Not settable from the public API.
    eval: bool = False


@dataclass
class LLMHandle:
    provider: str
    model: str
    make: Callable[[], Any]          # -> LangChain chat model (bind_tools + astream)


def default_llm_chain(deep: bool = False) -> List[LLMHandle]:
    """Configured provider chain.  Deep questions use copilot_deep_candidates()
    (COPILOT_MODEL_DEEP first when set) and the larger LLM_MAX_TOKENS_DEEP cap."""
    from app.services.agentic.bedrock_client import (build_copilot_llm, copilot_deep_candidates,
                                                     copilot_llm_candidates)
    cands = copilot_deep_candidates() if deep else copilot_llm_candidates()
    return [LLMHandle(c.provider, c.model, (lambda c=c: build_copilot_llm(c, deep=deep)))
            for c in cands]


def deep_token_cap(base_cap: int) -> int:
    try:
        return max(base_cap, int(os.getenv("LLM_MAX_TOKENS_DEEP", "6144")))
    except ValueError:
        return base_cap


def chunk_text(chunk: Any) -> str:
    content = getattr(chunk, "content", chunk)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content
                       if isinstance(b, dict) and b.get("type") in ("text", "text_delta"))
    return ""


def structured_compat(pack: TickerContextPack) -> Optional[Dict[str, Any]]:
    """Legacy `structured_data` payload for the existing snapshot cards."""
    out: Dict[str, Any] = {"symbol": pack.ticker}
    q, f = pack.quote, pack.fundamentals
    if q:
        out["quote"] = {"price": q.price, "change": q.change, "change_percent": q.change_percent,
                        "volume": q.volume, "high": q.day_high, "low": q.day_low, "open": None,
                        "previous_close": q.previous_close, "data_source": q.source}
    if f and any(v is not None for k, v in f.model_dump().items() if k not in ("id", "kind", "source", "as_of", "ticker")):
        out["fundamentals"] = {k: v for k, v in {
            "market_cap": f.market_cap, "pe_ratio": f.pe_ratio, "forward_pe": f.forward_pe,
            "peg_ratio": f.peg_ratio, "price_to_book": f.price_to_book, "eps": f.eps_ttm, "beta": f.beta,
            # percentage points, like /enhanced/fundamentals (27.6 == 27.6 %)
            "dividend_yield": f.dividend_yield_pct,
            "week_52_high": f.week_52_high,
            "week_52_low": f.week_52_low, "profit_margin": f.profit_margin_pct,
            "operating_margin": f.operating_margin_pct, "roe": f.roe_pct, "debt_to_equity": f.debt_to_equity,
            "current_ratio": f.current_ratio, "target_price": f.target_price,
            "recommendation": f.recommendation, "revenue": f.revenue_ttm}.items() if v is not None}
        out["company"] = {k: v for k, v in {"name": f.company_name or pack.name, "sector": f.sector,
                                            "industry": f.industry, "market_cap": f.market_cap}.items() if v}
    return out if len(out) > 1 else None


class CopilotEngine:
    def __init__(self, db, *, sources=None, llm_chain: Optional[Sequence[LLMHandle]] = None,
                 memory_store=None, use_pack_cache: bool = True,
                 extra_tools: Optional[Dict[str, Dict[str, Any]]] = None):
        if sources is None:
            from app.services.copilot.sources import LiveSources
            sources = LiveSources()
        if memory_store is None:
            from app.services.copilot.memory import RedisMemoryStore
            memory_store = RedisMemoryStore()
        self.db = db
        self.sources = sources
        self.llm_chain = list(llm_chain) if llm_chain is not None else None
        self.memory = memory_store
        self.use_pack_cache = use_pack_cache
        self.extra_tools = dict(extra_tools or {})     # per-engine plugins (eval: recorded tools)
        self.last_plan: Optional[planner.Plan] = None
        self.resolver = TickerResolver(db)
        self.last_trace: Dict[str, Any] = {}
        self.last_messages: List[Any] = []

    # ── helpers ──────────────────────────────────────────────────────────────
    async def _canned(self, trace: Trace, req: CopilotRequest, text: str, refusal: str,
                      mem: ConversationMemory, conversation_id: str) -> AsyncIterator[Event]:
        trace.mark("first_token")
        yield "token", {"text": text}
        trace.set(refusal=refusal, model=None)
        mem.turns += [{"role": "user", "content": req.message}, {"role": "assistant", "content": text}]
        await self.memory.save(req.user_id, conversation_id, mem)
        data = trace.finish()
        self.last_trace = data
        yield "done", {"request_id": req.request_id, "conversation_id": conversation_id, "model": None,
                       "provider": None, "refusal": refusal, "final_text": text, "citations": [],
                       "latency_ms": data["stages_ms"], "postcheck": None, "usage": {"llm_calls": 0}}

    # ── main ─────────────────────────────────────────────────────────────────
    async def run(self, req: CopilotRequest) -> AsyncIterator[Event]:
        from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
        conversation_id = req.conversation_id or str(uuid.uuid4())
        if req.eval:
            from app.services import ai_guard
            cur = ai_guard.current_context()
            if cur is None or not cur.is_eval:
                ai_guard.set_context(ai_guard.eval_guard_context("copilot_eval"))
        trace = Trace(req.request_id, req.user_id)
        trace.set(conversation_id=conversation_id, question_chars=len(req.message or ""))
        deep = planner.is_deep(req.message)
        trace.set(deep=deep)

        with trace.stage("memory"):
            try:
                mem = await asyncio.wait_for(self.memory.load(req.user_id, conversation_id), 2.0)
            except Exception:
                mem = ConversationMemory()

        with trace.stage("resolve"):
            res: Resolution = await asyncio.to_thread(
                self.resolver.resolve, req.message, req.symbol, mem.tickers,
                planner.DEEP_MAX_TICKERS if deep else None)
        trace.set(tickers=res.symbols, unknown=res.unknown, ticker_sources=[t.source for t in res.tickers])
        yield "intent", {"intent": "stock_analysis" if res.tickers else "text",
                         "symbol": res.primary.symbol if res.primary else None, "symbols": res.symbols,
                         "unknown": res.unknown}

        if not res.tickers and not res.finance_related:
            async for ev in self._canned(trace, req, OFF_TOPIC_REPLY, "off_topic", mem, conversation_id):
                yield ev
            return
        if not res.tickers and res.unknown:
            names = ", ".join(res.unknown[:3])
            text = (f"I couldn't find **{names}** in our symbol universe, so I have no price, filings or "
                    f"financials for it. Check the ticker spelling (share classes look like BRK.B), or tell "
                    f"me the company name.")
            async for ev in self._canned(trace, req, text, "unknown_ticker", mem, conversation_id):
                yield ev
            return

        # ── context packs ───────────────────────────────────────────────────
        filings_q = req.message if NEEDS_FILINGS.search(req.message or "") else None
        packs: Dict[str, TickerContextPack] = {}
        with trace.stage("context"):
            built = await asyncio.gather(*[
                build_pack(rt, self.sources, filings_query=filings_q, use_cache=self.use_pack_cache)
                for rt in res.tickers])
        registry = FactRegistry()
        for p in built:
            packs[p.ticker] = p
            registry.add_all(p.facts())
            # names / identity notes are context too ("S&P 500", "merged in 2025")
            registry.extra_numbers += numbers_in_text(f"{p.name or ''} {p.identity.note or ''}")
            trace.docs([c.id for c in p.filings])
            yield "context", p.summary()
            sd = structured_compat(p)
            if sd:
                yield "structured_data", sd
        trace.set(pack_errors={p.ticker: p.errors for p in built}, pack_cached=[p.ticker for p in built if p.cached])

        if res.tickers and all(p.is_empty() and p.identity.status == "ok" for p in built):
            text = (f"I don't have any market data, filings or financials for "
                    f"{', '.join(res.symbols)} right now, so I can't answer without guessing. "
                    f"Try again shortly or ask about another ticker.")
            async for ev in self._canned(trace, req, text, "no_data", mem, conversation_id):
                yield ev
            return

        # ── generation: tool-use loop ───────────────────────────────────────
        notes = [f"{rt.symbol}: {rt.identity.note}" for rt in res.tickers if rt.identity.note]
        if res.unknown:
            notes.append(f"Not found in symbol universe: {', '.join(res.unknown)}")
        async def pack_builder(rt):
            return await build_pack(rt, self.sources, use_cache=self.use_pack_cache)

        executor = ToolExecutor(self.sources, registry, self.resolver, packs, pack_builder,
                                timeout_s=planner.DEEP_TOOL_TIMEOUT_S if deep else None,
                                extra=self.extra_tools)

        # ── deep: plan + parallel prefetch ──────────────────────────────────
        plan: Optional[planner.Plan] = None
        extra_blocks: List[str] = []
        tool_calls_used = 0
        if deep:
            with trace.stage("plan"):
                plan = planner.build_plan(req.message, res.symbols, self.extra_tools)
            self.last_plan = plan
            yield "plan", plan.event()
            t_pf = time.perf_counter()
            with trace.stage("prefetch"):
                async for kind, data in planner.prefetch(plan, executor):
                    if kind == "progress":
                        yield "progress", data
                        if data["status"] == "running":
                            yield "tool", {"name": data["tool"], "args": data.get("args", {}),
                                           "status": "running", "id": data["id"], "label": data["label"]}
                        continue
                    call, facts, is_err = data["call"], data["facts"], data["is_error"]
                    tool_calls_used += 1
                    trace.tool(call.tool, call.args, int((time.perf_counter() - t_pf) * 1000), not is_err, len(facts))
                    trace.docs([f.id for f in facts if f.kind == "filing"])
                    if not is_err:
                        extra_blocks.append(data["content"])
                    yield "tool", {"name": call.tool, "args": call.args, "id": data["id"], "label": call.label,
                                   "status": "error" if is_err else "done", "facts": len(facts),
                                   "fact_ids": [f.id for f in facts][:20],
                                   "error": data["content"] if is_err else None}
            now_s = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
            extra_blocks.insert(0, context_block("plan", now_s, plan.llm_payload()))
            trace.set(plan=[{"cap": s.capability, "status": s.status, "tools": s.tools} for s in plan.steps])
            yield "plan", plan.event()

        messages: List[Any] = [SystemMessage(system_prompt(deep))]
        for role, content in history_messages(mem.turns):
            messages.append(HumanMessage(content) if role == "human" else _ai(content))
        messages.append(HumanMessage(user_turn(req.message, built, notes=notes, extra_blocks=extra_blocks)))

        chain = list(self.llm_chain if self.llm_chain is not None else default_llm_chain(deep))
        if not chain:
            llm_stats.stats.record(provider=None, model=None, ok=False, error="no LLM provider configured")
            yield "error", {"message": "No LLM provider is configured."}
            trace.set(error="no_llm"); self.last_trace = trace.finish()
            return

        parts: List[str] = []
        used: Optional[LLMHandle] = None
        emitted = False
        rounds = 0
        llm_calls = 0
        from app.services import ai_guard
        base_cap = ai_guard.io_caps()["max_tokens_sonnet"]
        meter = ai_guard.StreamMeter(deep_token_cap(base_cap) if deep else base_cap)
        tools = lc_tools(self.extra_tools)
        max_rounds = planner.DEEP_MAX_TOOL_ROUNDS if deep else MAX_TOOL_ROUNDS
        bound_llm = None
        call_kw: Dict[str, Any] = {}
        t_gen = time.perf_counter()
        first_token_ms: Optional[float] = None

        for idx, handle in enumerate(chain):
            cache_on = False
            try:
                llm = handle.make().bind_tools(tools)
                used = handle
                bound_llm = llm
                # Provider-specific system message + cache breakpoints (no-op
                # for OpenAI / OpenRouter / scripted models).
                cache_on = prompt_cache_enabled(handle.provider) and handle.model not in _CACHE_REJECTED
                messages[0] = system_message(handle.provider, cache=cache_on, deep=deep)
                call_kw = cache_call_kwargs(handle.provider, cache=cache_on)
                trace.set(prompt_cache=cache_on, chain_index=idx)
                for rnd in range(max_rounds + 1):
                    rounds = rnd + 1
                    full = None
                    llm_calls += 1
                    with trace.stage(f"llm_round_{rnd}"):
                        async for chunk in llm.astream(messages, **call_kw):
                            t = chunk_text(chunk)
                            if t:
                                if not emitted:
                                    trace.mark("first_token")
                                    first_token_ms = (time.perf_counter() - t_gen) * 1000
                                emitted = True
                                parts.append(t)
                                yield "token", {"text": t}
                                if not meter.add(t):
                                    break
                            full = chunk if full is None else full + chunk
                    calls = list(getattr(full, "tool_calls", None) or [])
                    if not calls:
                        break
                    if rnd == max_rounds:
                        note = "\n\n_(Stopped after the maximum number of data lookups.)_"
                        parts.append(note)
                        yield "token", {"text": note}
                        break
                    messages.append(full)
                    allowed = len(calls)
                    if deep:
                        allowed = max(0, min(len(calls), planner.DEEP_MAX_TOOL_CALLS - tool_calls_used))
                    tool_calls_used += allowed
                    for c in calls[:allowed]:
                        plug = executor.plugin(c["name"]) or {}
                        label = planner.progress_label(c["name"], c.get("args", {}), plug.get("spec"),
                                                       plug.get("progress"))
                        if deep:
                            yield "progress", {"label": label, "status": "running", "tool": c["name"], "id": c.get("id")}
                        yield "tool", {"name": c["name"], "args": c.get("args", {}), "status": "running",
                                       "id": c.get("id"), "label": label}
                    t_tools = time.perf_counter()
                    results = await asyncio.gather(
                        *[executor.run(c["name"], c.get("args", {})) for c in calls[:allowed]],
                        *[_over_budget() for _ in calls[allowed:]])
                    ms = int((time.perf_counter() - t_tools) * 1000)
                    trace.data["stages_ms"]["tools"] = trace.data["stages_ms"].get("tools", 0) + ms
                    for c, (content, facts, is_err) in zip(calls, results):
                        trace.tool(c["name"], c.get("args", {}), ms, not is_err, len(facts))
                        trace.docs([f.id for f in facts if f.kind == "filing"])
                        messages.append(ToolMessage(content=content, tool_call_id=c.get("id") or c["name"],
                                                    status="error" if is_err else "success"))
                        yield "tool", {"name": c["name"], "args": c.get("args", {}), "id": c.get("id"),
                                       "status": "error" if is_err else "done", "facts": len(facts),
                                       "fact_ids": [f.id for f in facts][:20],
                                       "error": content if is_err else None}
                        if deep:
                            yield "progress", {"tool": c["name"], "id": c.get("id"), "facts": len(facts),
                                               "status": "error" if is_err else "done",
                                               "label": c["name"].replace("_", " "),
                                               "error": content[:200] if is_err else None}
                    if parts and not parts[-1].endswith("\n"):
                        parts.append("\n\n")
                        yield "token", {"text": "\n\n"}
                break
            except ai_guard.AIQuotaError as e:
                yield "error", {"message": e.detail, "status": e.status_code}
                trace.set(error="quota"); self.last_trace = trace.finish()
                return
            except Exception as e:
                trace.data.setdefault("provider_errors", []).append(f"{handle.provider}:{handle.model}:{type(e).__name__}")
                if (cache_on and not emitted and rounds <= 1 and "cach" in str(e).lower()
                        and handle.model not in _CACHE_REJECTED):
                    # Model/endpoint rejected the cache breakpoints: remember
                    # that and retry the same model once without them.
                    logger.warning("prompt caching rejected by %s:%s (%s); retrying uncached",
                                   handle.provider, handle.model, str(e)[:160])
                    _CACHE_REJECTED.add(handle.model)
                    chain.insert(idx + 1, handle)
                    continue
                if emitted or rounds > 1 or idx == len(chain) - 1:
                    llm_stats.stats.record(provider=handle.provider, model=handle.model, ok=False,
                                           latency_ms=(time.perf_counter() - t_gen) * 1000,
                                           first_token_ms=first_token_ms, error=type(e).__name__)
                    yield "error", {"message": f"The language model failed ({type(e).__name__}). Please retry."}
                    trace.set(error=type(e).__name__); self.last_trace = trace.finish()
                    return
                continue          # fall through to the next provider (nothing streamed yet)

        self.last_messages = messages
        llm_stats.stats.record(provider=used.provider if used else None, model=used.model if used else None,
                               ok=True, latency_ms=(time.perf_counter() - t_gen) * 1000,
                               first_token_ms=first_token_ms)
        streamed = "".join(parts).strip()       # exactly what the client has received as tokens
        answer = streamed or "I couldn't produce an answer from the available data."
        repaired = False
        if deep and GROUNDING_REPAIR and bound_llm is not None:
            untraced = composer.untraceable(answer, registry, req.message)
            missing = [m for m in composer.missing_sections(answer) if m != "sources"]
            if untraced or missing:
                yield "progress", {"label": "Verifying every figure against tool outputs", "status": "running",
                                   "id": "verify"}
                rep_msgs = list(messages) + [_ai(answer), HumanMessage(
                    composer.repair_instruction(untraced, missing, plan))]
                fixed: List[str] = []
                try:
                    llm_calls += 1
                    with trace.stage("llm_repair"):
                        async for chunk in bound_llm.astream(rep_msgs, **call_kw):
                            t = chunk_text(chunk)
                            if t:
                                fixed.append(t)
                except Exception as e:                  # keep the original; finalize still blocks
                    trace.data.setdefault("provider_errors", []).append(f"repair:{type(e).__name__}")
                new = "".join(fixed).strip()
                if new:
                    answer, repaired = new, True
                yield "progress", {"label": "Verifying every figure against tool outputs", "status": "done",
                                   "id": "verify"}
            trace.set(repair_untraced=len(untraced), repair_missing=missing, repaired=repaired)
        with trace.stage("postcheck"):
            pc = (composer.finalize(answer, registry, req.message, plan) if deep
                  else run_postcheck(answer, registry, req.message))
        final = pc.text
        if "not financial advice" not in final.lower():
            final += DISCLAIMER
            if not pc.changed and not repaired:
                yield "token", {"text": DISCLAIMER}
        # an empty model turn streamed nothing, so the fallback must be sent as final_text
        changed = (final != streamed) and (pc.changed or repaired or not streamed)

        citations = []
        for n, fid in enumerate(pc.cited_ids, 1):
            f = registry.get(fid)
            if f is not None:
                c = {"n": n, **f.ui()}
                citations.append(c)
                yield "citation", c

        mem.turns += [{"role": "user", "content": req.message}, {"role": "assistant", "content": final[:4000]}]
        mem.tickers = res.symbols or mem.tickers
        try:
            await asyncio.wait_for(self.memory.save(req.user_id, conversation_id, mem), 2.0)
        except Exception:
            pass

        trace.set(model=used.model if used else None, provider=used.provider if used else None,
                  rounds=rounds, llm_calls=llm_calls, output_tokens_est=meter.tokens,
                  cited=pc.cited_ids, invalid_citations=pc.invalid_citations,
                  unverified_numbers=pc.unverified_numbers, policy_flags=pc.policy_flags)
        data = trace.finish()
        self.last_trace = data
        yield "done", {
            "request_id": req.request_id, "conversation_id": conversation_id,
            "model": used.model if used else None, "provider": used.provider if used else None,
            "final_text": final if changed else None, "answer_replaced": changed,
            "citations": citations, "postcheck": pc.summary(), "latency_ms": data["stages_ms"],
            "usage": {"llm_calls": llm_calls, "tool_rounds": max(0, rounds - 1),
                      "tool_calls": len(data["tools"]), "output_tokens_est": meter.tokens},
            "refusal": None,
            "deep": deep,
            "plan": plan.event() if plan is not None else None,
        }


async def _over_budget():
    return ("tool budget exhausted for this question; answer with the data already returned and say "
            "which computations were not run", [], True)


def _ai(content: str):
    from langchain_core.messages import AIMessage
    return AIMessage(content)
