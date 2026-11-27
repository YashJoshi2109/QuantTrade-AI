"""
Create the admin console tables and the append-only guard on admin_audit_log.

Tables: admin_audit_log, user_account_controls, user_login_events,
user_activity_days, system_status_snapshots, ops_events, copilot_request_metrics.
The app also creates them on startup via Base.metadata.create_all; this script
creates them ahead of a deploy. Idempotent (checkfirst + CREATE OR REPLACE /
DROP TRIGGER IF EXISTS). Never touches existing tables or rows.
Run: cd backend && python scripts/create_admin_console_tables.py
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine
from app.models.user import User  # noqa: F401  (FK target must be registered)
from app.models.admin import (
    AdminAuditLog,
    CopilotRequestMetric,
    OpsEvent,
    SystemStatusSnapshot,
    UserAccountControl,
    UserActivityDay,
    UserLoginEvent,
    install_audit_guard,
)


def migrate():
    if engine is None:
        print("No DATABASE_URL configured; nothing to do")
        return
    for model in (AdminAuditLog, UserAccountControl, UserLoginEvent, UserActivityDay, SystemStatusSnapshot,
                  OpsEvent, CopilotRequestMetric):
        try:
            model.__table__.create(bind=engine, checkfirst=True)
            print(f"  {model.__tablename__} table ready")
        except Exception as ex:
            print(f"  Warning ({model.__tablename__}): {ex}")
    try:
        if install_audit_guard(engine):
            print("  admin_audit_log append-only trigger installed")
    except Exception as ex:
        print(f"  Warning (audit guard): {ex}")
    print("Migration complete: admin console")


if __name__ == "__main__":
    migrate()
