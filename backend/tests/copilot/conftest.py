import pytest

from app.services import ai_guard


@pytest.fixture(autouse=True)
def _offline_guard():
    """Never touch shared Redis counters / the DB usage table from these tests."""
    ai_guard.set_store(ai_guard.MemoryStore())
    ai_guard.set_persist_sink(lambda e: None)
    yield
    ai_guard.set_store(None)
    ai_guard.set_persist_sink(None)


@pytest.fixture
def fixture_db():
    from app.services.copilot.evalkit import fixture_db as make
    db = make()
    yield db
    db.close()
