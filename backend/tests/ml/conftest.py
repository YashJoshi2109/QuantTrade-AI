"""Shared fixtures for ml tests that need a FastAPI test client."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.ml_runs import internal_router
from app.db.database import get_db


@pytest.fixture
def client(tmp_path):
    """Test client wired to the internal (no-auth) ml_runs router with an in-memory DB."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.db.database import Base

    db_url = f"sqlite:///{tmp_path}/test.db"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(internal_router, prefix="/api/v1")
    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as c:
        yield c
