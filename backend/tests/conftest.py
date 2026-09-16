import os
import tempfile
from pathlib import Path

import pytest

TMP_DB = Path(tempfile.gettempdir()) / "energia_test.db"
os.environ["EE_DATABASE_URL"] = f"sqlite:///{TMP_DB.as_posix()}"
os.environ["EE_CALC_CACHE_TTL"] = "1"


@pytest.fixture(scope="session", autouse=True)
def seeded_db():
    from app.db import SessionLocal, init_db
    from app.seed.run import seed

    init_db(drop=True)
    with SessionLocal() as db:
        seed(db)
    yield


@pytest.fixture
def db():
    from app.db import SessionLocal

    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


@pytest.fixture
def auth(client):
    def _login(username: str = "energia", password: str = "demo"):
        r = client.post("/api/auth/login", json={"username": username, "password": password})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    return _login
