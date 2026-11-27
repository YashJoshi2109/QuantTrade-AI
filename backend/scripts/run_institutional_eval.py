"""Institutional copilot eval: 24 deep questions -> rubric scorecard.

Modes
  offline (default)   real CopilotEngine + fixture packs + RECORDED tool outputs
                      + deterministic mock model. Same as the CI test
                      (tests/copilot/institutional_eval). No network, no spend.

  --live              in-process CopilotEngine with LiveSources, the configured
                      provider chain (COPILOT_MODEL_DEEP first if set) and the
                      tools registered in this checkout. Uses the DATABASE_URL in
                      your environment: point it at a dev / staging database,
                      never production. Spends ONLY the dedicated eval budget
                      (LLM_EVAL_DAILY_BUDGET_USD, default 0 = every model call is
                      refused); never the system or user budgets.

  --base-url URL      hit a deployed copilot over HTTP SSE, e.g.
                      --base-url https://<api-host>/api/v1 --token <JWT>
                      (token also read from COPILOT_EVAL_TOKEN). Spends that
                      account's AI quota.

Live rubric: tool-name regexes in questions.json describe the recorded tools;
against real engines a question passes `capabilities_executed` when every
required planner capability ran a tool successfully (use --strict-tools to also
require the regex names).

    cd backend && python scripts/run_institutional_eval.py                  # offline
    python scripts/run_institutional_eval.py --only Q02,Q22 -v
    python scripts/run_institutional_eval.py --live --out /tmp/inst-eval
    python scripts/run_institutional_eval.py --base-url https://host/api/v1 --token $JWT

Writes <out>/scorecard.json and <out>/scorecard.md (default:
backend/eval_results/institutional_<UTC timestamp>/). Exit code 1 if any
question fails.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("RUN_BACKGROUND_JOBS", "0")
HARNESS = BACKEND / "tests" / "copilot" / "institutional_eval" / "harness.py"


def _harness():
    spec = importlib.util.spec_from_file_location("institutional_harness", HARNESS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


async def run_live_inprocess(q: dict):
    from app.db.database import SessionLocal
    from app.services.copilot.engine import CopilotEngine, CopilotRequest
    from app.services.copilot.memory import InMemoryStore
    from app.services import ai_guard
    db = SessionLocal()
    try:
        eng = CopilotEngine(db, memory_store=InMemoryStore(), use_pack_cache=False)
        # eval=True: spend is charged only to LLM_EVAL_DAILY_BUDGET_USD (default 0 = refused),
        # never to the system or user budgets
        with ai_guard.eval_context("copilot_eval"):
            return [ev async for ev in eng.run(CopilotRequest(message=q["question"], user_id=0,
                                                              conversation_id=f"inst-live-{q['id']}", eval=True))]
    finally:
        db.close()


async def run_http(q: dict, base_url: str, token: str, timeout_s: float):
    import httpx
    events, name = [], ""
    headers = {"Authorization": f"Bearer {token}", "Accept": "text/event-stream", "User-Agent": "copilot-eval"}
    cookies = {"qt_access_token": token}
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=20)) as client:
        async with client.stream("POST", base_url.rstrip("/") + "/copilot/stream", headers=headers, cookies=cookies,
                                 json={"message": q["question"], "symbol": None, "conversation_id": None}) as resp:
            if resp.status_code != 200:
                body = (await resp.aread()).decode(errors="replace")[:300]
                return [("error", {"message": f"HTTP {resp.status_code}: {body}"})]
            async for line in resp.aiter_lines():
                if line.startswith("event: "):
                    name = line[7:].strip()
                elif line.startswith("data: ") and name == "heartbeat":
                    name = ""                       # SSE keepalive, not part of the answer
                elif line.startswith("data: ") and name:
                    try:
                        events.append((name, json.loads(line[6:])))
                    except json.JSONDecodeError:
                        pass
                    name = ""
    return events


def live_checks(h, q: dict, events, strict_tools: bool) -> dict:
    checks = h.score(q, events)
    done = next((d for n, d in events if n == "done"), None) or {}
    steps = {s.get("capability"): s for s in (done.get("plan") or {}).get("steps", [])}
    checks["capabilities_executed"] = all(steps.get(c, {}).get("status") in ("done", "partial", "in_context")
                                          for c in q["capabilities"])
    if not strict_tools:
        checks.pop("tools_called", None)
        for k in [k for k in checks if k.startswith("args:")]:
            checks.pop(k)
    return checks


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--base-url", default="")
    ap.add_argument("--token", default=os.getenv("COPILOT_EVAL_TOKEN", ""))
    ap.add_argument("--timeout", type=float, default=300.0, help="per-question timeout (s), live/http")
    ap.add_argument("--strict-tools", action="store_true")
    ap.add_argument("--out", default="")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()

    import logging
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("copilot.trace").setLevel(logging.WARNING)
    from app.services import ai_guard
    h = _harness()
    mode = "http" if a.base_url else "live" if a.live else "offline"
    if mode == "offline":
        ai_guard.set_store(ai_guard.MemoryStore())          # never touch shared Redis counters offline
        ai_guard.set_persist_sink(lambda e: None)
    if mode == "http" and not a.token:
        print("--base-url needs --token or COPILOT_EVAL_TOKEN", file=sys.stderr)
        return 2

    only = {x.strip() for x in a.only.split(",") if x.strip()}
    questions = [q for q in h.load_questions() if not only or q["id"] in only]
    rows = []
    for q in questions:
        t0 = time.perf_counter()
        try:
            if mode == "offline":
                events = (await h.run_question(q))["events"]
            elif mode == "live":
                events = await asyncio.wait_for(run_live_inprocess(q), a.timeout)
            else:
                events = await asyncio.wait_for(run_http(q, a.base_url, a.token, a.timeout), a.timeout + 30)
        except Exception as e:                               # one failure never stops the run
            events = [("error", {"message": f"{type(e).__name__}: {e}"})]
        ms = int((time.perf_counter() - t0) * 1000)
        checks = h.score(q, events) if mode == "offline" else live_checks(h, q, events, a.strict_tools)
        done = next((d for n, d in events if n == "done"), None) or {}
        pc = done.get("postcheck") or {}
        row = {"id": q["id"], "category": q["category"], "pass": all(checks.values()),
               "failed": [k for k, v in checks.items() if not v], "checks": checks, "latency_ms": ms,
               "tools": [d["name"] for n, d in events if n == "tool" and d.get("status") == "done"],
               "tool_errors": [d.get("error") for n, d in events if n == "tool" and d.get("status") == "error"],
               "untraceable": pc.get("unverified_numbers") or [], "not_executed": pc.get("not_executed") or [],
               "model": done.get("model"), "errors": [d.get("message") for n, d in events if n == "error"],
               "stages_ms": done.get("latency_ms")}
        if a.verbose:
            row["answer"] = h.answer_text(events)
        rows.append(row)
        print(f"{q['id']} {'PASS' if row['pass'] else 'FAIL'} {ms:>6}ms {', '.join(row['failed'])}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) if a.out else BACKEND / "eval_results" / f"institutional_{stamp}"
    out.mkdir(parents=True, exist_ok=True)
    summary = {"mode": mode, "generated_at": stamp, "passed": sum(r["pass"] for r in rows), "total": len(rows),
               "rows": rows}
    (out / "scorecard.json").write_text(json.dumps(summary, indent=2, default=str))
    (out / "scorecard.md").write_text(h.scorecard(rows) + f"\n\nMode: {mode}. Generated {stamp}.\n")
    print(f"\n{summary['passed']}/{summary['total']} pass  ->  {out / 'scorecard.md'}")
    return 0 if summary["passed"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
