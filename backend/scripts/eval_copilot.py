"""Copilot eval harness.

Offline (default): every golden question in tests/fixtures/copilot_golden.jsonl
runs through the real CopilotEngine with fixture data sources and a scripted
LLM that replays canned tool-use turns.  Deterministic checks: tickers
resolved, ticker scope, required/forbidden tools, refusal path (no LLM call),
citations valid, numbers grounded, injection handling, no advice/guarantees,
disclaimer, provider fallback.

    cd backend && python scripts/eval_copilot.py            # offline report
    python scripts/eval_copilot.py --json out.json          # machine-readable
    python scripts/eval_copilot.py --only Q08,Q13 -v        # debug some cases

Live mode (COPILOT_EVAL_LIVE=1 or --live): real data sources + the configured
provider chain (Bedrock Sonnet 5 -> ...).  Spends AI budget; scripted answers
are ignored and only structural checks apply.  Not run in CI.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("RUN_BACKGROUND_JOBS", "0")


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--json", default="")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    live = a.live or os.getenv("COPILOT_EVAL_LIVE") == "1"

    import logging
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("copilot.trace").setLevel(logging.WARNING)
    from app.services import ai_guard
    from app.services.copilot.evalkit import check_case, load_golden, run_case

    ai_guard.set_store(ai_guard.MemoryStore())        # never touch shared Redis counters offline
    ai_guard.set_persist_sink(lambda e: None)
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    cases = [c for c in load_golden() if not only or c["id"] in only]
    rows, passed = [], 0
    for case in cases:
        res = await run_case(case, live=live)
        checks = check_case(case, res)
        ok = all(checks.values())
        passed += ok
        failed = [k for k, v in checks.items() if not v]
        tr = res["trace"]
        rows.append({"id": case["id"], "category": case["category"], "pass": ok, "failed": failed,
                     "checks": checks, "tools": [t["name"] for t in tr.get("tools", [])],
                     "latency_ms": tr.get("stages_ms", {})})
        print(f"{'PASS' if ok else 'FAIL'}  {case['id']:<4} {case['category']:<26} "
              f"tools={','.join(rows[-1]['tools']) or '-':<32} {'' if ok else 'failed=' + ','.join(failed)}")
        if a.verbose or not ok:
            done = next((d for n, d in res["events"] if n == "done"), {})
            print("      postcheck:", json.dumps((done or {}).get("postcheck")))
            if a.verbose:
                print("      answer:", (done.get("final_text") or "".join(
                    d.get("text", "") for n, d in res["events"] if n == "token"))[:600])
    total = len(cases)
    rate = passed / total if total else 0.0
    print(f"\n{'LIVE' if live else 'OFFLINE'} pass rate: {passed}/{total} = {rate:.1%}")
    checks_total = sum(len(r["checks"]) for r in rows)
    checks_ok = sum(sum(r["checks"].values()) for r in rows)
    print(f"individual checks: {checks_ok}/{checks_total}")
    if a.json:
        Path(a.json).write_text(json.dumps({"pass_rate": rate, "passed": passed, "total": total,
                                            "rows": rows}, indent=2))
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
