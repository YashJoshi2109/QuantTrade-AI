"""Structured JSON logging for ML training pipeline.

Emits logs with run_id, shard_id, symbol, horizon, phase, status, duration_ms
for ingestion by CloudWatch, stdout, or any JSON log aggregator.
"""

from __future__ import annotations

import json
import logging
import time
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from typing import Any, Generator

logger = logging.getLogger("ml.pipeline")


@dataclass
class LogContext:
    """Immutable context carried through a training run."""
    run_id: str = ""
    shard_id: str = ""
    shard_name: str = ""
    trigger_source: str = "unknown"  # github_actions | eventbridge | api | manual


@dataclass
class LogEntry:
    """Structured log entry for ML pipeline events."""
    phase: str  # download | feature | train | eval | checkpoint | upload | aggregate
    status: str  # started | completed | failed | skipped
    symbol: str = ""
    horizon: int = 0
    duration_ms: int = 0
    error_type: str = ""  # data | training | infra | timeout
    error_message: str = ""
    retry_count: int = 0
    metrics: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)


class StructuredLogger:
    """Emit structured JSON logs with pipeline context."""

    def __init__(self, context: LogContext | None = None):
        self.context = context or LogContext()
        self._counters: dict[str, int] = {}

    def set_context(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            if hasattr(self.context, k):
                setattr(self.context, k, v)

    def log(self, entry: LogEntry, level: int = logging.INFO) -> None:
        record = {
            **{k: v for k, v in asdict(self.context).items() if v},
            **{k: v for k, v in asdict(entry).items() if v},
        }
        # Remove empty dicts
        record = {k: v for k, v in record.items() if v != {} and v != 0 and v != ""}
        # Always include phase and status
        record["phase"] = entry.phase
        record["status"] = entry.status

        logger.log(level, json.dumps(record, default=str))

        # Track counters
        key = f"{entry.phase}.{entry.status}"
        self._counters[key] = self._counters.get(key, 0) + 1

    def info(self, phase: str, status: str, **kwargs: Any) -> None:
        self.log(LogEntry(phase=phase, status=status, **kwargs))

    def error(self, phase: str, error_type: str, error_message: str, **kwargs: Any) -> None:
        self.log(
            LogEntry(phase=phase, status="failed", error_type=error_type, error_message=error_message, **kwargs),
            level=logging.ERROR,
        )

    @contextmanager
    def timed(self, phase: str, **kwargs: Any) -> Generator[dict[str, Any], None, None]:
        """Context manager that logs started/completed/failed with duration."""
        self.info(phase, "started", **kwargs)
        metrics: dict[str, Any] = {}
        start = time.monotonic()
        try:
            yield metrics
            duration_ms = int((time.monotonic() - start) * 1000)
            self.info(phase, "completed", duration_ms=duration_ms, metrics=metrics, **kwargs)
        except Exception as e:
            duration_ms = int((time.monotonic() - start) * 1000)
            error_type = "training" if "train" in phase else "data" if "download" in phase or "feature" in phase else "infra"
            self.error(phase, error_type=error_type, error_message=str(e)[:500], duration_ms=duration_ms, **kwargs)
            raise

    def get_counters(self) -> dict[str, int]:
        return dict(self._counters)


# Module-level singleton for convenience
_default_logger: StructuredLogger | None = None


def get_structured_logger() -> StructuredLogger:
    global _default_logger
    if _default_logger is None:
        _default_logger = StructuredLogger()
    return _default_logger


def reset_structured_logger(context: LogContext | None = None) -> StructuredLogger:
    global _default_logger
    _default_logger = StructuredLogger(context)
    return _default_logger
