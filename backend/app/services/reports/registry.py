"""Named, read-only SQL report tasks loaded from ``tasks/*.sql``.

File format follows DungBeetle / goyesql: each query starts with a
``-- name: <task>`` line, followed by optional ``-- key: value`` header lines,
then the SQL. Supported header keys:

* ``title`` / ``description``: shown to users.
* ``scope``: ``user`` (default) or ``public``. A user task always receives the
  caller's id as ``:user_id``; it is injected server-side, never taken from the
  request. A public task's result is shared by every user (one cache entry).
* ``ttl``: seconds a finished result is served before the task runs again.
* ``args``: comma-separated ``name:type[=default]``. Types:
  ``date`` (YYYY-MM-DD, start of that day UTC), ``date_end`` (YYYY-MM-DD,
  inclusive: bound to the start of the next day UTC, so SQL uses ``<``),
  ``int``, ``str``. ``today`` is a valid date default.

SQL uses named binds (``:from_date``) and must be portable across PostgreSQL
and SQLite (tests). Only SELECT / WITH statements are accepted.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import DateTime, Integer, String, bindparam, text
from sqlalchemy.sql.elements import TextClause

TASKS_DIR = Path(__file__).resolve().parent / "tasks"

ARG_TYPES = {"date", "date_end", "int", "str"}
_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_READ_ONLY_RE = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)
_WRITE_RE = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|merge|call)\b",
    re.IGNORECASE,
)
MAX_STR_ARG = 64
MIN_TTL_S, MAX_TTL_S = 30, 24 * 3600


class ArgError(ValueError):
    """A request argument is missing, unknown or invalid (HTTP 400)."""


@dataclass(frozen=True)
class TaskArg:
    name: str
    type: str
    default: Optional[str] = None

    def coerce(self, raw: Any) -> Any:
        if raw is None or raw == "":
            if self.default is None:
                raise ArgError(f"Missing argument {self.name!r}")
            raw = self.default
        if self.type in ("date", "date_end"):
            if raw == "today":
                d = datetime.now(timezone.utc).date()
            else:
                try:
                    d = date.fromisoformat(str(raw))
                except ValueError:
                    raise ArgError(f"{self.name} must be a date (YYYY-MM-DD)")
            if self.type == "date_end":
                d = d + timedelta(days=1)
            return datetime.combine(d, time.min, tzinfo=timezone.utc)
        if self.type == "int":
            try:
                v = int(str(raw))
            except ValueError:
                raise ArgError(f"{self.name} must be an integer")
            if abs(v) > 10**9:
                raise ArgError(f"{self.name} is out of range")
            return v
        s = str(raw).strip()
        if len(s) > MAX_STR_ARG:
            raise ArgError(f"{self.name} is too long")
        return s

    def canonical(self, raw: Any) -> str:
        """Stable text form of the argument, used in the job's dedupe key.

        ``today`` is resolved to the date, so yesterday's cached result is not
        served for today's request."""
        v = self.coerce(raw)
        if isinstance(v, datetime):
            return v.date().isoformat()
        return str(v)

    def public(self) -> dict:
        return {"name": self.name, "type": self.type, "default": self.default}


@dataclass(frozen=True)
class ReportTask:
    name: str
    sql: str
    title: str = ""
    description: str = ""
    scope: str = "user"
    ttl_s: int = 300
    args: List[TaskArg] = field(default_factory=list)

    def statement(self) -> TextClause:
        binds = []
        for a in self.args:
            if a.type in ("date", "date_end"):
                binds.append(bindparam(a.name, type_=DateTime(timezone=True)))
            elif a.type == "int":
                binds.append(bindparam(a.name, type_=Integer))
            else:
                binds.append(bindparam(a.name, type_=String))
        if self.scope == "user":
            binds.append(bindparam("user_id", type_=Integer))
        return text(self.sql).bindparams(*binds)

    def bind_args(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        raw = dict(raw or {})
        unknown = set(raw) - {a.name for a in self.args}
        if unknown:
            raise ArgError(f"Unknown argument(s): {', '.join(sorted(unknown))}")
        return {a.name: a.coerce(raw.get(a.name)) for a in self.args}

    def canonical_args(self, raw: Dict[str, Any]) -> Dict[str, str]:
        self.bind_args(raw)  # validates
        return {a.name: a.canonical((raw or {}).get(a.name)) for a in self.args}

    def public(self) -> dict:
        return {
            "name": self.name,
            "title": self.title or self.name.replace("_", " ").title(),
            "description": self.description,
            "scope": self.scope,
            "ttl_s": self.ttl_s,
            "args": [a.public() for a in self.args],
        }


def _parse_args(spec: str) -> List[TaskArg]:
    out: List[TaskArg] = []
    for part in [p.strip() for p in spec.split(",") if p.strip()]:
        m = re.match(r"^([a-z][a-z0-9_]*):([a-z_]+)(?:=(.+))?$", part)
        if not m or m.group(2) not in ARG_TYPES:
            raise ValueError(f"Bad arg spec {part!r}")
        if m.group(1) == "user_id":
            raise ValueError("user_id is reserved (injected server-side)")
        out.append(TaskArg(m.group(1), m.group(2), m.group(3)))
    return out


def parse_sql_tasks(source: str) -> List[ReportTask]:
    """Parse one goyesql-style file into tasks."""
    tasks: List[ReportTask] = []
    current: Optional[Dict[str, Any]] = None
    sql_lines: List[str] = []

    def flush():
        if current is None:
            return
        sql = "\n".join(sql_lines).strip().rstrip(";").strip()
        if not sql:
            raise ValueError(f"Task {current['name']!r} has no SQL")
        if ";" in sql:
            raise ValueError(f"Task {current['name']!r} must be a single statement")
        if not _READ_ONLY_RE.match(sql) or _WRITE_RE.search(sql):
            raise ValueError(f"Task {current['name']!r} must be a read-only SELECT")
        scope = current.get("scope", "user")
        if scope not in ("user", "public"):
            raise ValueError(f"Task {current['name']!r}: bad scope {scope!r}")
        if scope == "user" and ":user_id" not in sql:
            raise ValueError(f"User task {current['name']!r} must filter by :user_id")
        ttl = int(current.get("ttl", 300))
        tasks.append(ReportTask(
            name=current["name"],
            sql=sql,
            title=current.get("title", ""),
            description=current.get("description", ""),
            scope=scope,
            ttl_s=max(MIN_TTL_S, min(MAX_TTL_S, ttl)),
            args=_parse_args(current.get("args", "")),
        ))

    for line in source.splitlines():
        m = re.match(r"^\s*--\s*([a-z_]+)\s*:\s*(.*?)\s*$", line)
        if m and m.group(1) == "name":
            flush()
            name = m.group(2)
            if not _NAME_RE.match(name):
                raise ValueError(f"Bad task name {name!r}")
            current, sql_lines = {"name": name}, []
            continue
        if current is not None and m and not sql_lines:
            current[m.group(1)] = m.group(2)
            continue
        if current is not None:
            if line.strip().startswith("--"):
                continue  # plain SQL comment
            sql_lines.append(line)
    flush()
    return tasks


def load_tasks(directory: Path = TASKS_DIR) -> Dict[str, ReportTask]:
    tasks: Dict[str, ReportTask] = {}
    for path in sorted(directory.glob("*.sql")):
        for t in parse_sql_tasks(path.read_text(encoding="utf-8")):
            if t.name in tasks:
                raise ValueError(f"Duplicate report task {t.name!r} in {path.name}")
            tasks[t.name] = t
    return tasks
