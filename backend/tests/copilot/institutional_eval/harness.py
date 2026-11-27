"""Institutional regression eval: 24 deep questions, rubric scoring.

Offline (CI): the real CopilotEngine runs each question with
  * FixtureSources (+ fixture_extra.json symbols) for ticker packs,
  * RECORDED tool outputs (recorded_tools.json) registered as per-engine
    plugins, standing in for the fundamentals_/valuation_/quant_/filings_
    engines,
  * MockAnalystLLM, a deterministic LangChain-compatible model that calls
    any planned tool the planner could not prefetch, then writes a structured
    answer using ONLY the tool outputs it was given.
Live mode (scripts/run_institutional_eval.py --live): the same rubric over the
real provider chain and real tools.

Rubric (per question, see questions.json): deep mode, tickers resolved,
planner capabilities present, required tools called successfully, required
sections present, required metrics present, citations valid and sufficient,
no untraceable numbers, server-rendered Sources, progress streamed; plus the
honesty variant (a capability's tool removed -> the answer must say it was
not executed and contain no fabricated results).
"""
from __future__ import annotations

import asyncio
import copy
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from app.services.copilot import composer
from app.services.copilot.evalkit import FIXTURE_DATA, FixtureSources, fixture_db
from app.services.copilot.models import compact_fact
from app.services.copilot.provenance import computed_fact

HERE = Path(__file__).resolve().parent
QUESTIONS = HERE / "questions.json"
RECORDED = HERE / "recorded_tools.json"
EXTRA = HERE / "fixture_extra.json"
_CTX = re.compile(r'<context source="([^"]+)" as_of="([^"]*)">\n(.*?)\n</context>', re.S)


# ── data ─────────────────────────────────────────────────────────────────────
def load_questions() -> List[dict]:
    return json.loads(QUESTIONS.read_text())["questions"]


def fixture_data() -> dict:
    base = json.loads(FIXTURE_DATA.read_text())
    extra = json.loads(EXTRA.read_text())
    have = {s["symbol"] for s in base["symbols"]}
    base["symbols"] += [s for s in extra["symbols"] if s["symbol"] not in have]
    for t, v in extra["tickers"].items():
        base["tickers"].setdefault(t, v)
    return base


def _fill(obj: Any, ticker: str) -> Any:
    if isinstance(obj, str):
        return obj.replace("{ticker}", ticker)
    if isinstance(obj, dict):
        return {k: _fill(v, ticker) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_fill(v, ticker) for v in obj]
    return obj


def recorded_tools(drop: Iterable[str] = (), delay_s: Optional[Dict[str, float]] = None,
                   fail: Iterable[str] = (), timeout_s: Optional[Dict[str, float]] = None) -> Dict[str, Dict[str, Any]]:
    """Recorded tools as engine plugins ({name: {spec, handler, progress, timeout_s}})."""
    data = json.loads(RECORDED.read_text())["tools"]
    drop, fail = set(drop), set(fail)
    out: Dict[str, Dict[str, Any]] = {}
    for name, t in data.items():
        if name in drop:
            continue

        async def handler(executor, args, _name=name, _t=t):
            if delay_s and _name in delay_s:
                await asyncio.sleep(delay_s[_name])
            if _name in fail:
                raise LookupError(f"{_name}: upstream data not available (recorded failure)")
            tickers = args.get("tickers") or [args.get("ticker") or args.get("symbol")]
            tickers = [x for x in tickers if x]
            per = _t.get("per_ticker") or len(tickers) <= 1
            facts = []
            for tk in (tickers if per else [",".join(tickers)]):
                first = tk.split(",")[0] if tk else ""
                r = copy.deepcopy(_t["responses"].get(first) or _t["responses"]["*"])
                r = _fill(r, tk or "")
                facts.append(computed_fact(_name, tk if per else None, args={**args, "_t": tk}, **r))
            return facts, [compact_fact(f) for f in facts]

        out[name] = {"spec": t["spec"], "handler": handler, "progress": t.get("progress"),
                     "timeout_s": (timeout_s or {}).get(name)}
    return out


# ── deterministic analyst model ──────────────────────────────────────────────
def _blocks(messages) -> List[tuple]:
    out = []
    for m in messages:
        content = m.content if isinstance(m.content, str) else json.dumps(m.content)
        for src, as_of, body in _CTX.findall(content):
            try:
                out.append((src, as_of, json.loads(body)))
            except json.JSONDecodeError:
                continue
    return out


def _fmt(v: Any) -> Optional[str]:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        if float(v) == int(v) and abs(v) >= 1e4:
            return f"{int(v):,}"
        return str(v)
    return str(v)


def _human(k: str) -> str:
    return k.replace("_", " ")


class MockAnalystLLM:
    """Deterministic stand-in for the answer model (offline CI).

    round 0: calls every tool in a 'planned' plan step (args: plan tickers +
    schema defaults for other required params); then writes the structured
    answer from tool outputs only.  On a repair instruction it replaces each
    flagged figure with 'unavailable'."""

    def __init__(self, extra_text: str = "", fabricate: Optional[str] = None, honest_repair: bool = True):
        self.extra_text = extra_text          # appended to the Results (e.g. an untraceable figure)
        self.fabricate = fabricate            # text written when a step is unavailable (adversarial)
        self.honest_repair = honest_repair
        self.seen: List[List[Any]] = []
        self.tools: List[dict] = []
        self.i = 0
        self.repair_requests = 0

    def bind_tools(self, tools, **kw):
        self.tools = list(tools)
        return self

    def _spec(self, name):
        return next((t for t in self.tools if t["name"] == name), None)

    async def astream(self, messages, **kw):
        from langchain_core.messages import AIMessageChunk
        self.seen.append(list(messages))
        self.i += 1
        last = messages[-1]
        text = last.content if isinstance(last.content, str) else ""
        if getattr(last, "type", "") == "human" and text.startswith("Revise your previous answer"):
            self.repair_requests += 1
            prior = messages[-2].content
            if self.honest_repair:
                figs = re.findall(r'"([^"]+)"', text.split("These figures do not match", 1)[-1].split(". For each", 1)[0])
                for f in sorted(set(figs), key=len, reverse=True):
                    prior = prior.replace(f, "unavailable")
            for k in range(0, len(prior), 200):
                yield AIMessageChunk(content=prior[k:k + 200])
            return
        blocks = _blocks(messages)
        plan = next((b for s, _, b in blocks if s == "plan"), None)
        already_called = any(getattr(m, "type", "") == "tool" for m in messages)
        if plan and not already_called:
            calls = []
            for st in plan["steps"]:
                if st["status"] != "planned":
                    continue
                for name in st["tools"]:
                    spec = self._spec(name)
                    if spec is None or name.startswith("get_"):
                        continue
                    props = spec["input_schema"].get("properties", {})
                    req = spec["input_schema"].get("required", [])
                    base = {p: props[p]["default"] for p in req if "default" in props.get(p, {})}
                    if "tickers" in props:
                        calls.append({"name": name, "args": {**base, "tickers": plan["tickers"]}})
                    else:
                        calls += [{"name": name, "args": {**base, "ticker": t}} for t in plan["tickers"]]
            if calls:
                for n, c in enumerate(calls):
                    yield AIMessageChunk(content="", tool_call_chunks=[{
                        "name": c["name"], "args": json.dumps(c["args"]), "id": f"m{self.i}_{n}", "index": n}])
                return
        answer = self.compose(blocks, plan)
        for k in range(0, len(answer), 120):
            yield AIMessageChunk(content=answer[k:k + 120])

    def compose(self, blocks, plan) -> str:
        facts = []
        for src, as_of, body in blocks:
            if not src.startswith("tool:"):
                continue
            for f in (body if isinstance(body, list) else [body]):
                if isinstance(f, dict) and f.get("id") and f.get("values"):
                    if all(f["id"] != g["id"] for g in facts):
                        facts.append(f)
        not_run = [s for s in (plan or {}).get("steps", []) if s["status"] in ("unavailable", "failed")]
        tickers = ", ".join((plan or {}).get("tickers", []))
        L: List[str] = ["## Summary", ""]
        if facts:
            f0 = facts[0]
            k, v = next(((k, v) for k, v in f0["values"].items() if v is not None), (None, None))
            L.append(f"For {tickers}, {len(facts)} tool computations were executed. "
                     + (f"Headline: {f0.get('title')}: {_human(k)} {_fmt(v)} [{f0['id']}]." if k else ""))
        else:
            L.append(f"For {tickers}, no tool computation returned results.")
        for s in not_run:
            L.append(f"{s['need']} was not executed (no tool available), so no result is reported for it.")
            if self.fabricate:
                L.append(self.fabricate)
        L += ["", "## Data & Method", ""]
        by_tool = {}
        for f in facts:
            by_tool.setdefault(f.get("tool"), f)            # one method line per tool
        for f in by_tool.values():
            forms = "; ".join(f"{_human(k)} = {v}" for k, v in (f.get("formulas") or {}).items())
            L.append(f"- {f.get('title')} ({f.get('tool')}): {forms or 'see tool output'}; "
                     f"source {f.get('source')}, as of {f.get('as_of')} [{f['id']}]")
        L += ["", "## Results", "", "| Metric | Value | Source |", "|---|---|---|"]
        for f in facts:
            for k, v in f["values"].items():
                s = _fmt(v)
                if s is not None:
                    L.append(f"| {f.get('title')}: {_human(k)} | {s} | [{f['id']}] |")
        for f in facts:
            rows = f.get("table") or []
            if rows and isinstance(rows[0], dict):
                cols = list(rows[0])
                L += ["", f"**{f.get('title')} table** [{f['id']}]", "", "| " + " | ".join(_human(c) for c in cols) + " |",
                      "|" + "---|" * len(cols)]
                for r in rows[:8]:
                    L.append("| " + " | ".join(_fmt(r.get(c)) or "" for c in cols) + " |")
        if self.extra_text:
            L += ["", self.extra_text]
        L += ["", "## Interpretation", "",
              "The results above come from deterministic tools; differences between measures reflect their "
              "definitions and sample windows, not new data."]
        L += ["", "## Verified facts vs assumptions/interpretation", "",
              "- Verified facts: the tool outputs cited above (" + ", ".join(f"[{f['id']}]" for f in facts[:8]) + ")."]
        for f in by_tool.values():
            for k, v in (f.get("assumptions") or {}).items():
                L.append(f"- Assumption (parameter, not a fact): {_human(k)} = {v} [{f['id']}]")
        L.append("- Interpretation: the reading of these figures in the Interpretation section is analysis, not disclosed fact.")
        L += ["", "## Limitations", "", "- Historical data; models are sensitive to their parameters."]
        for s in not_run:
            L.append(f"- {s['need']}: not executed.")
        L += ["", "## Sources", "", ", ".join(f"[{f['id']}]" for f in facts)]
        return "\n".join(L)


# ── run + score ──────────────────────────────────────────────────────────────
async def run_question(q: dict, *, tools: Optional[Dict[str, Dict[str, Any]]] = None, llm=None,
                       data: Optional[dict] = None) -> Dict[str, Any]:
    from app.services.copilot.engine import CopilotEngine, CopilotRequest, LLMHandle
    from app.services.copilot.memory import InMemoryStore
    data = data or fixture_data()
    llm = llm or MockAnalystLLM()
    db = fixture_db(data)
    try:
        eng = CopilotEngine(db, sources=FixtureSources(data), llm_chain=[LLMHandle("scripted", "mock-analyst", lambda: llm)],
                            memory_store=InMemoryStore(), use_pack_cache=False,
                            extra_tools=tools if tools is not None else recorded_tools())
        events = [ev async for ev in eng.run(CopilotRequest(message=q["question"], user_id=1,
                                                            conversation_id=f"inst-{q['id']}"))]
    finally:
        db.close()
    return {"events": events, "trace": eng.last_trace, "llm": llm, "plan": eng.last_plan}


def answer_text(events) -> str:
    done = next((d for n, d in events if n == "done"), {}) or {}
    return done.get("final_text") or "".join(d.get("text", "") for n, d in events if n == "token")


def score(q: dict, events: Sequence[tuple], *, unavailable_variant: bool = False) -> Dict[str, bool]:
    done = next((d for n, d in events if n == "done"), None) or {}
    errors = [d for n, d in events if n == "error"]
    text = answer_text(events)
    pc = done.get("postcheck") or {}
    cites = done.get("citations") or []
    intents = [d for n, d in events if n == "intent"]
    resolved = set(intents[-1]["symbols"]) if intents else set()
    plan = done.get("plan") or {}
    caps = {s.get("capability") for s in plan.get("steps", [])}
    ok_tools = [d for n, d in events if n == "tool" and d.get("status") == "done"]
    called = [d["name"] for d in ok_tools]
    skip_caps = set(q.get("honesty_unavailable") or []) if unavailable_variant else set()

    c: Dict[str, bool] = {}
    c["no_error"] = not errors and bool(done)
    c["deep_mode"] = done.get("deep") is True
    c["tickers_resolved"] = set(q["tickers"]) <= resolved
    c["plan_capabilities"] = set(q["capabilities"]) <= caps
    pats = q["tools"] if not unavailable_variant else [p for p in q["tools"] if not _pattern_for_caps(p, skip_caps)]
    c["tools_called"] = all(any(re.search(p, n) for n in called) for p in pats)
    c["sections"] = not composer.missing_sections(text) and "_Not provided in this answer._" not in text
    if not unavailable_variant:
        c["metrics"] = all(re.search(m, text, re.I) for m in q.get("metrics", []))
        c["citations"] = len(cites) >= q.get("min_citations", 1) and not pc.get("invalid_citations")
    else:
        c["citations"] = not pc.get("invalid_citations")
    c["no_untraceable_numbers"] = not pc.get("unverified_numbers") and composer.UNVERIFIED_TOKEN not in text
    c["sources_rendered"] = "## Sources" in text and all(x.get("as_of") or x.get("filed_date") for x in cites)
    c["progress_streamed"] = any(n == "progress" for n, _ in events)
    if q.get("require_filing_citation") and not unavailable_variant:
        c["filing_citation"] = any(x.get("accession") or x.get("filed_date") for x in cites)
    for tool, args in (q.get("expect_args") or {}).items():
        if unavailable_variant:
            continue
        c[f"args:{tool}"] = any(d["name"] == tool and all(d.get("args", {}).get(k) == v for k, v in args.items())
                                for d in ok_tools)
    if unavailable_variant:
        c["discloses_not_executed"] = "Not executed" in text or "not executed" in text
        c["no_fabricated_results"] = not any(re.search(p, text, re.I) for p in q.get("forbid_when_unavailable", []))
    return c


_CAP_TOOL_HINT = {"monte_carlo": "monte_carlo"}


def _pattern_for_caps(pattern: str, caps: set) -> bool:
    return any(_CAP_TOOL_HINT.get(c, c) in pattern for c in caps)


def scorecard(rows: List[dict]) -> str:
    n = len(rows)
    passed = sum(r["pass"] for r in rows)
    lines = [f"# Institutional eval scorecard", "", f"**{passed}/{n} questions pass every rubric check.**", "",
             "| Q | Category | Pass | Failed checks | Tools called | Untraceable | Latency ms |",
             "|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['id']} | {r['category']} | {'yes' if r['pass'] else 'no'} | {', '.join(r['failed']) or '-'} | "
                     f"{len(r.get('tools', []))} | {len(r.get('untraceable', []))} | {r.get('latency_ms', '')} |")
    return "\n".join(lines)
