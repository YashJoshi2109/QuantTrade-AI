"""Root conftest: add backend directory to sys.path so `app.*` imports resolve."""
import sys
import os

# Ensure the backend root is on sys.path for all tests under tests/
sys.path.insert(0, os.path.dirname(__file__))

# Manual integration scripts that are not pytest tests (require live DB/services)
collect_ignore = [
    "tests/test_global_monitor_integration.py",
]

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_ai_guard():
    """Every test gets a fresh in-memory AI-guard store and no usage persistence,
    so no test ever touches Redis or the database through the guard."""
    try:
        from app.services import ai_guard
    except Exception:  # pragma: no cover
        yield
        return
    ai_guard.set_store(ai_guard.MemoryStore())
    ai_guard.set_persist_sink(lambda event: None)
    ai_guard._mem_cache.clear()
    yield
    ai_guard.set_store(None)
    ai_guard.set_persist_sink(None)
    ai_guard._mem_cache.clear()
