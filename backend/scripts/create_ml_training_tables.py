"""Create ML training metadata tables in Neon PostgreSQL.

Idempotent — safe to run multiple times. Uses SQLAlchemy's checkfirst=True.

Usage:
    python -m scripts.create_ml_training_tables
"""

import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import engine, Base

# Import models so they register with Base.metadata
from app.models.ml_training import TrainingRun, TrainingShard, TrainingArtifact, ModelVersion


def main():
    print("Creating ML training metadata tables...")
    print(f"  Database: {str(engine.url).split('@')[1] if '@' in str(engine.url) else 'local'}")

    # Create only the ML training tables (not all tables)
    tables = [
        TrainingRun.__table__,
        TrainingShard.__table__,
        TrainingArtifact.__table__,
        ModelVersion.__table__,
    ]

    for table in tables:
        table.create(engine, checkfirst=True)
        print(f"  ✓ {table.name}")

    print("Done.")


if __name__ == "__main__":
    main()
