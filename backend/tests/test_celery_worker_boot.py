"""The celery-worker must be able to open its Redis broker channel.

Regression: celery 5.3.4 accepts any kombu<6, so a fresh image build resolved
kombu 5.7.0, whose Redis transport raises VersionMismatch for redis-py<6.1.
The worker died at broker connect and Docker restarted it in a loop.
"""
import re
from pathlib import Path
from types import SimpleNamespace

BACKEND = Path(__file__).resolve().parents[1]


def test_installed_kombu_accepts_installed_redis():
    # Channel._get_client is the exact check kombu runs when the worker
    # creates its broker channel; it raises VersionMismatch on a bad pair.
    from kombu.transport.redis import Channel

    client = Channel._get_client(SimpleNamespace(global_keyprefix=None))
    assert client is not None


def _pins(req_file: str) -> dict:
    pins = {}
    for line in (BACKEND / req_file).read_text().splitlines():
        m = re.match(r"^([A-Za-z0-9_.\-\[\]]+)==([^\s#]+)", line.strip())
        if m:
            pins[m.group(1).lower()] = m.group(2)
    return pins


def test_requirements_pin_kombu_with_compatible_redis():
    for req in ("requirements.txt", "requirements-core.txt"):
        pins = _pins(req)
        assert "kombu" in pins, f"{req}: pin kombu (celery leaves it unbounded below 6)"
        kombu = tuple(int(x) for x in pins["kombu"].split(".")[:2])
        redis = tuple(int(x) for x in pins["redis"].split(".")[:2])
        if kombu >= (5, 7):
            assert redis >= (6, 1), f"{req}: kombu {pins['kombu']} needs redis>=6.1"


def test_celery_app_config_is_bounded_for_small_host():
    from app.tasks.celery_app import celery_app

    conf = celery_app.conf
    assert conf.broker_connection_retry_on_startup is True
    assert 0 < conf.worker_max_memory_per_child <= 400_000
    assert conf.worker_max_tasks_per_child
