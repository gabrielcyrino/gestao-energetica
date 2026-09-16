"""Configuração do banco: aceita a variável e o formato de URL entregues pela integração Neon ↔ Vercel."""
from app.config import Settings

NEON = "postgresql://neondb_owner:npg_x@ep-demo-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"


def test_database_url_from_neon_integration_variable(monkeypatch):
    monkeypatch.delenv("EE_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", NEON)
    url = Settings().database_url
    assert url.startswith("postgresql+psycopg://neondb_owner:")
    assert url.endswith("?sslmode=require&channel_binding=require")


def test_explicit_variable_takes_precedence(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", NEON)
    monkeypatch.setenv("EE_DATABASE_URL", "postgresql+psycopg://u:p@outro-host/db")
    assert Settings().database_url == "postgresql+psycopg://u:p@outro-host/db"


def test_postgres_scheme_aliases_are_normalized(monkeypatch):
    monkeypatch.setenv("EE_DATABASE_URL", "postgres://u:p@host:5432/db")
    assert Settings().database_url == "postgresql+psycopg://u:p@host:5432/db"


def test_sqlite_is_untouched(monkeypatch):
    monkeypatch.setenv("EE_DATABASE_URL", "sqlite:///./data/x.db")
    assert Settings().database_url == "sqlite:///./data/x.db"
