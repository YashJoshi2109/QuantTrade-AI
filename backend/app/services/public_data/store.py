"""Small DB helpers shared by the public-data loaders (Postgres and SQLite)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlalchemy.orm import Session

from app.models.public_data import PublicDataLoad

BATCH = 2000


def upsert(db: Session, model, rows: Sequence[Dict[str, Any]], keys: Sequence[str]) -> int:
    """Insert-or-update by natural key (the table's unique constraint).
    Portable: reads existing keys, updates those, bulk-inserts the rest."""
    if not rows:
        return 0
    n = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        first = keys[0]
        vals = list({r[first] for r in chunk})
        existing = {}
        for obj in db.query(model).filter(getattr(model, first).in_(vals)).all():
            existing[tuple(getattr(obj, k) for k in keys)] = obj
        new = []
        seen = set()
        for r in chunk:
            k = tuple(r[c] for c in keys)
            if k in seen:
                continue
            seen.add(k)
            obj = existing.get(k)
            if obj is None:
                new.append(r)
            else:
                for c, v in r.items():
                    setattr(obj, c, v)
        if new:
            db.bulk_insert_mappings(model, new)
        n += len(seen)
        db.flush()
    db.commit()
    return n


def load_row(db: Session, dataset: str, key: str) -> Optional[PublicDataLoad]:
    return db.query(PublicDataLoad).filter_by(dataset=dataset, key=key).one_or_none()


def mark_load(db: Session, dataset: str, key: str, *, status: str = "done", rows: int = 0,
              source_last_modified: Optional[str] = None, note: Optional[str] = None) -> None:
    row = load_row(db, dataset, key)
    if row is None:
        row = PublicDataLoad(dataset=dataset, key=key)
        db.add(row)
    row.status, row.rows, row.note = status, rows, (note or "")[:2000]
    if source_last_modified is not None:
        row.source_last_modified = source_last_modified
    row.loaded_at = datetime.now(timezone.utc)
    db.commit()


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def aware(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite returns naive datetimes; treat them as UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def chunks(it: Iterable[Any], n: int) -> Iterable[List[Any]]:
    buf: List[Any] = []
    for x in it:
        buf.append(x)
        if len(buf) >= n:
            yield buf
            buf = []
    if buf:
        yield buf
