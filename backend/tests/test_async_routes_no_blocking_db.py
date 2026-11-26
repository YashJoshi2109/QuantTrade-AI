"""Static guard: async route handlers must not do blocking DB / sync I/O on the event loop.

Prod runs a single uvicorn worker. A synchronous SQLAlchemy call (``db.query``,
``db.execute``, ``db.commit`` ...) or ``time.sleep`` / ``requests.*`` inside an
``async def`` route stalls *every* in-flight request until it returns.

Fix options for a flagged handler:
  * no ``await`` needed -> make it a plain ``def`` (FastAPI runs it in the threadpool);
  * it awaits things   -> move the blocking part into a sync helper and call it via
    ``await asyncio.to_thread(helper, ...)`` (keep all use of the request Session
    inside that one thread call; a Session is not safe for concurrent threads).

The walk covers the route body and any nested ``async def`` (those also run on
the loop). Nested sync ``def`` / ``lambda`` bodies are skipped: in this codebase
they are the helpers handed to ``asyncio.to_thread`` / ``run_in_executor``.
"""
from __future__ import annotations

import ast
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent / "app" / "api"

ROUTE_DECORATORS = {"get", "post", "put", "patch", "delete", "head", "options", "api_route", "websocket"}
SESSION_NAMES = {"db", "session", "bg_db", "db_s"}
SESSION_METHODS = {
    "query", "execute", "commit", "rollback", "flush", "refresh",
    "add", "add_all", "merge", "scalar", "scalars", "bulk_save_objects",
}
BLOCKING_MODULE_CALLS = {
    ("time", "sleep"),
    ("requests", "get"), ("requests", "post"), ("requests", "put"),
    ("requests", "patch"), ("requests", "delete"), ("requests", "request"),
}

# "file.py:function" -> justification. Keep empty unless truly necessary.
ALLOWLIST: dict[str, str] = {}


def _is_route(fn: ast.AsyncFunctionDef) -> bool:
    for dec in fn.decorator_list:
        target = dec.func if isinstance(dec, ast.Call) else dec
        if isinstance(target, ast.Attribute) and target.attr in ROUTE_DECORATORS:
            return True
    return False


def _loop_side_nodes(fn: ast.AsyncFunctionDef):
    """Yield nodes that execute on the event loop (skip nested sync defs and lambdas)."""
    stack = list(fn.body)
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.Lambda, ast.ClassDef)):
            continue
        yield node
        stack.extend(ast.iter_child_nodes(node))


def _blocking_calls(fn: ast.AsyncFunctionDef) -> list[str]:
    hits = []
    for node in _loop_side_nodes(fn):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        recv, attr = node.func.value, node.func.attr
        if not isinstance(recv, ast.Name):
            continue
        if recv.id in SESSION_NAMES and attr in SESSION_METHODS:
            hits.append(f"{recv.id}.{attr}() at line {node.lineno}")
        elif (recv.id, attr) in BLOCKING_MODULE_CALLS:
            hits.append(f"{recv.id}.{attr}() at line {node.lineno}")
    return hits


def _async_routes():
    for path in sorted(API_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and _is_route(node):
                yield path.name, node


def test_scanner_finds_async_routes():
    # Sanity check so a broken scanner can't pass vacuously.
    assert sum(1 for _ in _async_routes()) > 20


def test_scanner_flags_blocking_db_call():
    src = (
        "@router.get('/x')\n"
        "async def h(db):\n"
        "    def ok():\n"
        "        return db.query(1)\n"
        "    async def bad():\n"
        "        db.commit()\n"
        "    db.query(2)\n"
    )
    fn = ast.parse(src).body[0]
    hits = _blocking_calls(fn)
    assert len(hits) == 2 and all("line" in h for h in hits)


def test_async_routes_do_not_block_event_loop():
    offenders = []
    for filename, fn in _async_routes():
        key = f"{filename}:{fn.name}"
        if key in ALLOWLIST:
            continue
        hits = _blocking_calls(fn)
        if hits:
            offenders.append(f"{key} (line {fn.lineno}): " + ", ".join(hits))
    assert not offenders, (
        "async route handlers call blocking DB / sync I/O on the event loop "
        "(use `def`, or `await asyncio.to_thread(helper, ...)`):\n  " + "\n  ".join(offenders)
    )
