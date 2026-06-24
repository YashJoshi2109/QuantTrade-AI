"""
Initialize all database tables on AWS RDS PostgreSQL.

Imports EVERY module under app/models/ so all SQLAlchemy models register on
Base.metadata, enables the pgvector extension, then runs create_all().

Usage:
    DATABASE_URL=postgresql://... python scripts/init_rds_database.py
"""
import importlib
import pkgutil
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import text

import app.models as models_pkg
from app.db.database import engine, Base


def _import_all_models() -> list[str]:
    """Import every submodule of app.models so every table registers."""
    imported = []
    for mod in pkgutil.iter_modules(models_pkg.__path__):
        name = f"app.models.{mod.name}"
        importlib.import_module(name)
        imported.append(mod.name)
    return imported


def init_database() -> None:
    if engine is None:
        print("❌ DATABASE_URL not set — engine is None. Aborting.")
        sys.exit(1)

    print("🚀 Initializing RDS database")
    print("=" * 60)

    modules = _import_all_models()
    print(f"📦 Imported {len(modules)} model modules")

    with engine.connect() as conn:
        version = conn.execute(text("SELECT version()")).scalar()
        print(f"✅ Connected: {version[:60]}...")

    # pgvector must exist before create_all (some columns use Vector type)
    with engine.begin() as conn:
        try:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            print("✅ pgvector extension ready")
        except Exception as e:  # noqa: BLE001
            print(f"⚠️  Could not create pgvector extension: {e}")

    print(f"\n📋 Creating {len(Base.metadata.tables)} tables...")
    Base.metadata.create_all(bind=engine, checkfirst=True)

    with engine.connect() as conn:
        tables = [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema='public' ORDER BY table_name"
                )
            )
        ]
    print(f"✅ {len(tables)} tables in public schema:")
    for t in tables:
        print(f"   - {t}")
    print("\n✅ RDS initialization complete!")


if __name__ == "__main__":
    init_database()
