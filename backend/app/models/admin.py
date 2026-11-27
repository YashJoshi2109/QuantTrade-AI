"""
Admin console tables.

  admin_audit_log        append-only record of every admin action and every
                         sensitive admin read (table views, conversation views).
                         Rows are never updated or deleted: the ORM refuses it
                         (see the mapper events below) and on PostgreSQL the
                         migration script installs a trigger that rejects
                         UPDATE / DELETE / TRUNCATE.
  user_account_controls  admin-managed state per user, kept out of ``users`` so
                         adding it never alters the hot users table:
                         suspension, session version (bumped to revoke every
                         JWT issued before), plan override, AI quota override.
  user_login_events      sign-in history (method, IP, user agent) used for the
                         admin "sessions / devices" view.

No FK from admin_audit_log to users: the audit trail must outlive the account.
"""
from __future__ import annotations

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, event
from sqlalchemy.sql import func

from app.db.database import Base


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    actor_user_id = Column(Integer, nullable=False, index=True)
    action = Column(String(64), nullable=False, index=True)
    target_type = Column(String(32), nullable=True)
    target_id = Column(String(128), nullable=True, index=True)
    reason = Column(Text, nullable=True)
    ip = Column(String(64), nullable=True)
    details = Column(JSON, nullable=True)

    __table_args__ = (
        Index("ix_admin_audit_log_target", "target_type", "target_id"),
    )


class AppendOnlyError(RuntimeError):
    pass


@event.listens_for(AdminAuditLog, "before_update")
def _audit_no_update(mapper, connection, target):  # pragma: no cover - exercised in tests
    raise AppendOnlyError("admin_audit_log is append-only")


@event.listens_for(AdminAuditLog, "before_delete")
def _audit_no_delete(mapper, connection, target):  # pragma: no cover - exercised in tests
    raise AppendOnlyError("admin_audit_log is append-only")


AUDIT_GUARD_SQL = (
    """
    CREATE OR REPLACE FUNCTION admin_audit_log_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'admin_audit_log is append-only';
    END;
    $$ LANGUAGE plpgsql
    """,
    "DROP TRIGGER IF EXISTS admin_audit_log_no_mutation ON admin_audit_log",
    """
    CREATE TRIGGER admin_audit_log_no_mutation
      BEFORE UPDATE OR DELETE ON admin_audit_log
      FOR EACH ROW EXECUTE FUNCTION admin_audit_log_append_only()
    """,
    "DROP TRIGGER IF EXISTS admin_audit_log_no_truncate ON admin_audit_log",
    """
    CREATE TRIGGER admin_audit_log_no_truncate
      BEFORE TRUNCATE ON admin_audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_log_append_only()
    """,
)


def install_audit_guard(engine) -> bool:
    """PostgreSQL: reject UPDATE / DELETE / TRUNCATE on admin_audit_log. Idempotent."""
    if engine is None or engine.dialect.name != "postgresql":
        return False
    from sqlalchemy import text
    with engine.begin() as conn:
        for stmt in AUDIT_GUARD_SQL:
            conn.execute(text(stmt))
    return True


class UserAccountControl(Base):
    __tablename__ = "user_account_controls"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Suspension blocks sign-in and every authenticated API call.
    suspended_at = Column(DateTime(timezone=True), nullable=True)
    suspended_reason = Column(Text, nullable=True)
    suspended_by = Column(Integer, nullable=True)
    # JWTs carry "sv"; a token whose sv is below this value is rejected.
    session_version = Column(Integer, nullable=False, default=0, server_default="0")
    sessions_revoked_at = Column(DateTime(timezone=True), nullable=True)
    # None = follow Stripe; "free" | "pro" = forced by an admin.
    plan_override = Column(String(16), nullable=True)
    # {"req_per_day": int, "tokens_per_day": int, ...}: replaces the tier's values.
    ai_quota_override = Column(JSON, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UserLoginEvent(Base):
    __tablename__ = "user_login_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    method = Column(String(16), nullable=False)  # password | google | passkey | register
    success = Column(Boolean, nullable=False, default=True)
    note = Column(String(64), nullable=True)  # e.g. "suspended"
    ip = Column(String(64), nullable=True)
    user_agent = Column(String(300), nullable=True)


class UserActivityDay(Base):
    """One row per user per UTC day with any authenticated API call.
    Written at most once per (user, day) per API process (see admin_metrics)."""
    __tablename__ = "user_activity_days"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    day = Column(String(10), primary_key=True)  # YYYY-MM-DD (UTC)
    first_seen = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_user_activity_days_day", "day"),
    )


class SystemStatusSnapshot(Base):
    """Periodic copy of /api/v1/system/status (leader process only): the source
    of the admin 30-day availability bars."""
    __tablename__ = "system_status_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    overall = Column(String(16), nullable=False)
    services = Column(JSON, nullable=False)  # [{"id", "name", "group", "status", "latency_ms"}]


class OpsEvent(Base):
    """Operational activity feed: service status transitions, deploys."""
    __tablename__ = "ops_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    kind = Column(String(32), nullable=False, index=True)  # service_status | deploy
    severity = Column(String(16), nullable=False, default="info")  # info | warning | critical | ok
    title = Column(String(200), nullable=False)
    details = Column(JSON, nullable=True)


class CopilotRequestMetric(Base):
    """One row per Copilot request, from the request trace (no prompt or answer
    text): latency, provider/model, fallback depth, retrieval and citations."""
    __tablename__ = "copilot_request_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    user_id = Column(Integer, nullable=True, index=True)
    provider = Column(String(32), nullable=True)
    model = Column(String(120), nullable=True)
    ok = Column(Boolean, nullable=False, default=True)
    error = Column(String(64), nullable=True)
    refusal = Column(Boolean, nullable=False, default=False)
    total_ms = Column(Integer, nullable=True)
    first_token_ms = Column(Integer, nullable=True)
    chain_index = Column(Integer, nullable=True)  # 0 = primary model; >0 = a fallback answered
    retrieval_calls = Column(Integer, nullable=False, default=0)
    retrieval_empty = Column(Integer, nullable=False, default=0)
    retrieval_ms = Column(Integer, nullable=True)
    citations = Column(Integer, nullable=False, default=0)
    invalid_citations = Column(Integer, nullable=False, default=0)
    policy_flags = Column(Integer, nullable=False, default=0)
