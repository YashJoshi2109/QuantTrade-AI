"""
Async report jobs: results store (DungBeetle-style, see docs/ZERODHA_DATA_PATTERNS.md).

One row per report job. A job is a named, read-only SQL task run off the
request path; its result set is written here once and then served to the user
from this table (paged, or as CSV) until ``expires_at``. Re-submitting the same
task with the same arguments while a fresh result exists returns it without
touching the source tables again.

``job_id`` is deterministic: sha256(task, owner_key, canonical args). That gives
dedupe and request coalescing for free.

``owner_key`` is the user id (as text) for user-scoped tasks (statements) and
``"*"`` for public tasks (market-data reports shared by every user).

Created by Base.metadata.create_all on startup and by
scripts/create_report_results_table.py on deploy (idempotent).
Rollback: DROP TABLE IF EXISTS report_results; (nothing else references it).
"""
from sqlalchemy import JSON, Boolean, Column, DateTime, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.db.database import Base


class ReportResult(Base):
    __tablename__ = "report_results"

    job_id = Column(String(64), primary_key=True)
    task = Column(String(64), nullable=False)
    owner_key = Column(String(32), nullable=False)
    submitted_by = Column(Integer, nullable=True)
    args_json = Column(JSON, nullable=False, default=dict)

    # queued | running | done | error | cancelled
    status = Column(String(16), nullable=False, default="queued")
    error = Column(Text, nullable=True)

    columns_json = Column(JSON, nullable=True)
    rows_json = Column(JSON, nullable=True)
    row_count = Column(Integer, nullable=False, default=0)
    truncated = Column(Boolean, nullable=False, default=False)
    duration_ms = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_report_results_owner_created", "owner_key", "created_at"),
        Index("ix_report_results_expires", "expires_at"),
    )
