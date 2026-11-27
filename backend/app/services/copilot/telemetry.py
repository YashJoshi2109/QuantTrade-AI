"""Per-request trace: stage timings, tool calls, retrieved doc ids, model, usage.

Emitted as ONE structured log line (logger ``copilot.trace``) per request.  No
PII beyond the numeric user id (the question text is not logged; only its
length).  Optional exporters, enabled by env and only if the package is
installed:
  COPILOT_OTEL=1          -> an OpenTelemetry span with the trace as attributes
  LANGFUSE_PUBLIC_KEY=... -> a Langfuse trace (langfuse SDK)
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("copilot.trace")
if not logger.handlers and not logging.getLogger().handlers:
    # The API never calls logging.basicConfig; without a handler INFO traces
    # would be dropped.  One stdout line per request -> CloudWatch / docker logs.
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s %(name)s %(message)s"))
    logger.addHandler(_h)
    logger.setLevel(os.getenv("COPILOT_TRACE_LEVEL", "INFO"))
    logger.propagate = False


class Trace:
    def __init__(self, request_id: str, user_id: Optional[int]):
        self.t0 = time.perf_counter()
        self.data: Dict[str, Any] = {"request_id": request_id, "user_id": user_id,
                                     "stages_ms": {}, "tools": [], "doc_ids": [],
                                     "llm_calls": 0, "rounds": 0}

    @contextlib.contextmanager
    def stage(self, name: str):
        t = time.perf_counter()
        try:
            yield
        finally:
            self.data["stages_ms"][name] = self.data["stages_ms"].get(name, 0) + int((time.perf_counter() - t) * 1000)

    def mark(self, name: str) -> None:
        """Time from request start to an event (e.g. first_token)."""
        self.data["stages_ms"].setdefault(name, int((time.perf_counter() - self.t0) * 1000))

    def tool(self, name: str, args: Dict[str, Any], ms: int, ok: bool, n_facts: int) -> None:
        self.data["tools"].append({"name": name, "args": args, "ms": ms, "ok": ok, "facts": n_facts})

    def docs(self, ids: List[str]) -> None:
        for i in ids:
            if i not in self.data["doc_ids"]:
                self.data["doc_ids"].append(i)

    def set(self, **kw: Any) -> None:
        self.data.update(kw)

    def finish(self) -> Dict[str, Any]:
        self.data["stages_ms"]["total"] = int((time.perf_counter() - self.t0) * 1000)
        logger.info(json.dumps(self.data, default=str, separators=(",", ":")))
        _export(self.data)
        try:  # admin console AI observability (no prompt / answer text)
            from app.services.admin_metrics import record_copilot_trace
            record_copilot_trace(self.data)
        except Exception:  # noqa: BLE001
            pass
        return self.data


def _export(data: Dict[str, Any]) -> None:
    if os.getenv("COPILOT_OTEL") == "1":
        try:
            from opentelemetry import trace as ot
            with ot.get_tracer("quanttrade.copilot").start_as_current_span("copilot.request") as span:
                for k, v in data.items():
                    span.set_attribute(f"copilot.{k}", v if isinstance(v, (str, int, float, bool)) else json.dumps(v, default=str))
        except Exception as e:  # exporter problems never break a request
            logger.debug("otel export skipped: %s", e)
    if os.getenv("LANGFUSE_PUBLIC_KEY"):
        try:
            from langfuse import Langfuse  # type: ignore
            Langfuse().trace(name="copilot.request", id=data.get("request_id"),
                             user_id=str(data.get("user_id")), metadata=data)
        except Exception as e:
            logger.debug("langfuse export skipped: %s", e)
