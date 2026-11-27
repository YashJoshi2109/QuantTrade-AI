"""
Read-only database explorer for the admin console.

Guarantees:
  * No arbitrary SQL. Table and column names must exist in the schema
    reflected from the database (whitelist); every value is a bound parameter.
  * Every query runs inside a READ ONLY transaction with a statement_timeout
    (PostgreSQL) or with ``PRAGMA query_only`` (SQLite, tests), on its own
    connection, and is always rolled back. When ADMIN_DB_READONLY_URL is set,
    a separate engine (point it at a read-only DB role) is used.
  * Sensitive columns are always redacted (column-name patterns + binary
    columns + per-table content columns such as chat transcripts).
"""
from __future__ import annotations

import contextlib
import os
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Iterator, List, Optional, Tuple

from sqlalchemy import MetaData, String, Table, asc, cast, desc, func, inspect, select, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.types import LargeBinary

REDACTED = "•••redacted•••"
STATEMENT_TIMEOUT_MS = int(os.getenv("ADMIN_DB_STATEMENT_TIMEOUT_MS", "5000"))
MAX_PAGE_SIZE = 100
MAX_CELL_CHARS = 500
EXACT_COUNT_BELOW = 50_000
# Emails are masked like the user directory; the audited reveal lives there.
_EMAIL_RE = re.compile(r"(^|_)e?mail(_address)?$", re.IGNORECASE)

# Column-name patterns that are always redacted, in every table.
SENSITIVE_PATTERNS: Tuple[str, ...] = (
    r"pass(word|wd)?", r"hash", r"secret", r"token", r"api_?key", r"otp", r"public_key", r"private_key",
    r"sign_count", r"credential_id", r"refresh", r"session_id", r"^stripe_", r"_stripe_", r"google_id",
    r"phone", r"date_of_birth", r"^dob$", r"salt", r"signature", r"authorization", r"cookie", r"webhook",
)
_SENSITIVE_RE = re.compile("|".join(f"(?:{p})" for p in SENSITIVE_PATTERNS), re.IGNORECASE)

# Free-text user content that is never shown in the explorer (conversation
# transcripts are viewable only through the audited per-user endpoint).
SENSITIVE_TABLE_COLUMNS: Dict[str, Tuple[str, ...]] = {
    "chat_history": ("content", "payload_json"),
    "messages": ("content", "body", "attachments"),
    "conversations": ("title",),
    "preferences": ("value",),
    "users": ("preferences_json",),
}

_engine_cache: Dict[str, Engine] = {}


# Usage counters that only *mention* tokens (LLM token counts) are not secrets.
_COUNTER_RE = re.compile(r"^(input|output|total|cache_read|cache_write|embed|max|prompt|completion)_tokens?(_est)?$"
                         r"|^tokens?_(used|count|per_day|limit|in|out)$", re.IGNORECASE)


def is_sensitive(table: str, column: str, coltype: Any = None) -> bool:
    if _COUNTER_RE.search(column or "") and not (coltype is not None and isinstance(coltype, LargeBinary)):
        return column in SENSITIVE_TABLE_COLUMNS.get(table, ())
    if _SENSITIVE_RE.search(column or ""):
        return True
    if column in SENSITIVE_TABLE_COLUMNS.get(table, ()):
        return True
    if coltype is not None and isinstance(coltype, LargeBinary):
        return True
    return False


def explorer_engine(default: Engine) -> Engine:
    url = os.getenv("ADMIN_DB_READONLY_URL", "").strip()
    if not url:
        return default
    eng = _engine_cache.get(url)
    if eng is None:
        from sqlalchemy import create_engine
        eng = create_engine(url, pool_pre_ping=True, pool_size=2, max_overflow=0)
        _engine_cache[url] = eng
    return eng


@contextlib.contextmanager
def read_only(engine: Engine) -> Iterator[Connection]:
    """A connection inside a READ ONLY transaction, always rolled back."""
    conn = engine.connect()
    dialect = engine.dialect.name
    trans = conn.begin()
    try:
        if dialect == "postgresql":
            conn.execute(text("SET TRANSACTION READ ONLY"))
            # SET cannot take a bind parameter; set_config(..., is_local=true) is the
            # parametrised equivalent of SET LOCAL statement_timeout.
            conn.execute(text("SELECT set_config('statement_timeout', :ms, true)"), {"ms": f"{int(STATEMENT_TIMEOUT_MS)}ms"})
        elif dialect == "sqlite":
            conn.exec_driver_sql("PRAGMA query_only = ON")
        yield conn
    finally:
        try:
            trans.rollback()
        finally:
            if dialect == "sqlite":
                try:
                    conn.exec_driver_sql("PRAGMA query_only = OFF")
                except Exception:  # noqa: BLE001
                    pass
            conn.close()


def _table_names(conn: Connection) -> List[str]:
    return sorted(inspect(conn).get_table_names())


def list_tables(engine: Engine) -> List[Dict[str, Any]]:
    with read_only(engine) as conn:
        names = _table_names(conn)
        stats: Dict[str, Tuple[Optional[int], Optional[int]]] = {}
        if engine.dialect.name == "postgresql":
            rows = conn.execute(text(
                "SELECT c.relname, GREATEST(c.reltuples, 0)::bigint, pg_total_relation_size(c.oid) "
                "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE c.relkind IN ('r','p') AND n.nspname = current_schema()"
            )).fetchall()
            live = dict(conn.execute(text(
                "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname = current_schema()"
            )).fetchall())
            exact: set = set()
            for name, est, size in rows:
                n = live.get(name)
                n = int(n if n is not None else est)
                # Planner stats are stale for small / never-analysed tables: count
                # those exactly (cheap below the threshold, and under the timeout).
                if n < EXACT_COUNT_BELOW and name in names:
                    try:
                        t = Table(name, MetaData(), autoload_with=conn)
                        n = int(conn.execute(select(func.count()).select_from(t)).scalar() or 0)
                        exact.add(name)
                    except Exception:  # noqa: BLE001
                        pass
                stats[name] = (n, int(size))
            approx = True
        else:
            exact = set(names)
            md = MetaData()
            for name in names:
                t = Table(name, md, autoload_with=conn)
                stats[name] = (int(conn.execute(select(func.count()).select_from(t)).scalar() or 0), None)
            approx = False
        out = []
        for name in names:
            cols = inspect(conn).get_columns(name)
            n, size = stats.get(name, (None, None))
            out.append({
                "name": name, "row_count": n, "row_count_estimated": approx and name not in exact,
                "size_bytes": size,
                "columns": len(cols),
                "redacted_columns": [c["name"] for c in cols if is_sensitive(name, c["name"], c.get("type"))],
            })
        return out


def _cell(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return REDACTED
    s = value if isinstance(value, str) else str(value)
    return s if len(s) <= MAX_CELL_CHARS else s[:MAX_CELL_CHARS] + "…"


def _mask(value: Any) -> Any:
    from app.services.admin_service import mask_email
    return mask_email(value) if isinstance(value, str) else _cell(value)


class ExplorerError(ValueError):
    pass


def browse(engine: Engine, table: str, *, page: int = 1, page_size: int = 25, sort: Optional[str] = None,
           order: str = "asc", filter_col: Optional[str] = None, filter_val: Optional[str] = None) -> Dict[str, Any]:
    page = max(1, int(page))
    page_size = max(1, min(MAX_PAGE_SIZE, int(page_size)))
    with read_only(engine) as conn:
        if table not in _table_names(conn):  # whitelist from the reflected schema
            raise ExplorerError("Unknown table")
        t = Table(table, MetaData(), autoload_with=conn)
        cols = list(t.columns)
        names = [c.name for c in cols]
        sensitive = {c.name for c in cols if is_sensitive(table, c.name, c.type)}
        q = select(t)
        cq = select(func.count()).select_from(t)
        if filter_col:
            if filter_col not in names:
                raise ExplorerError("Unknown filter column")
            if filter_col in sensitive or _EMAIL_RE.search(filter_col):
                raise ExplorerError("Cannot filter on a redacted or masked column")
            cond = cast(t.c[filter_col], String).ilike(f"%{(filter_val or '')[:200]}%")
            q, cq = q.where(cond), cq.where(cond)
        if sort:
            if sort not in names:
                raise ExplorerError("Unknown sort column")
            if sort in sensitive or _EMAIL_RE.search(sort):
                raise ExplorerError("Cannot sort on a redacted or masked column")
            q = q.order_by(desc(t.c[sort]) if order == "desc" else asc(t.c[sort]))
        else:
            pk = [c for c in cols if c.primary_key]
            if pk:
                q = q.order_by(*[asc(c) for c in pk])
        total = int(conn.execute(cq).scalar() or 0)
        rows = conn.execute(q.limit(page_size).offset((page - 1) * page_size)).mappings().all()
        emails = {n for n in names if _EMAIL_RE.search(n) and n not in sensitive}
        data = [{k: (REDACTED if k in sensitive else _mask(r[k]) if k in emails else _cell(r[k])) for k in names}
                for r in rows]
        return {
            "table": table, "page": page, "page_size": page_size, "total": total,
            "columns": [{"name": c.name, "type": str(c.type), "redacted": c.name in sensitive,
                         "masked": c.name in emails,
                         "primary_key": bool(c.primary_key)} for c in cols],
            "rows": data,
        }
