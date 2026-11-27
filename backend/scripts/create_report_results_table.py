"""
Create the report_results table (async report jobs, /api/v1/reports) and its indexes.

New table only: no existing table or column is changed, so it is safe to run
before or after the new backend image is live. The app also creates it on
startup via Base.metadata.create_all. Idempotent.

Rollback: DROP TABLE IF EXISTS report_results;  (nothing references it; the
old backend image ignores it). Pass --drop to do exactly that.

Run: cd backend && python scripts/create_report_results_table.py [--drop]
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine  # noqa: E402
from app.models.report_job import ReportResult  # noqa: E402


def migrate():
    ReportResult.__table__.create(bind=engine, checkfirst=True)
    for ix in ReportResult.__table__.indexes:
        ix.create(bind=engine, checkfirst=True)
    print("✅ report_results table ready")


def rollback():
    ReportResult.__table__.drop(bind=engine, checkfirst=True)
    print("✅ report_results table dropped")


if __name__ == "__main__":
    if engine is None:
        print("  skipped (DATABASE_URL not set)")
        sys.exit(0)
    rollback() if "--drop" in sys.argv else migrate()
