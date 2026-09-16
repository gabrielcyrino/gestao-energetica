"""Engine e sessão SQLAlchemy.

O mesmo modelo roda em três cenários:
- SQLite (demonstração local, sem infraestrutura);
- PostgreSQL/TimescaleDB (servidor ou container, com hypertables e agregados contínuos);
- PostgreSQL gerenciado em ambiente serverless (Vercel + Neon/Supabase): sem pool no processo,
  porque cada invocação é efêmera e o pooler fica do lado do banco.
"""
import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def is_serverless() -> bool:
    """Vercel/Lambda definem estas variáveis; também pode ser forçado por EE_SERVERLESS."""
    return bool(os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME") or os.getenv("EE_SERVERLESS"))


def _make_engine() -> Engine:
    url = get_settings().database_url
    if url.startswith("sqlite"):
        if is_serverless():
            raise RuntimeError(
                "SQLite não funciona em ambiente serverless (sistema de arquivos efêmero). "
                "Conecte um banco Neon ao projeto Vercel (cria DATABASE_URL automaticamente) ou defina "
                "EE_DATABASE_URL com um PostgreSQL gerenciado — e faça um novo deploy. "
                "Guia: docs/08-deploy-vercel.md"
            )
        Path(url.replace("sqlite:///", "")).parent.mkdir(parents=True, exist_ok=True)
        eng = create_engine(url, connect_args={"check_same_thread": False})

        @event.listens_for(eng, "connect")
        def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover - infraestrutura
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

        return eng

    if is_serverless():
        # Sem pool local + sem prepared statements: obrigatório atrás de PgBouncer em modo transação
        # (endpoint "-pooler" do Neon, "pgbouncer=true" do Supabase).
        return create_engine(
            url,
            poolclass=NullPool,
            connect_args={"prepare_threshold": None, "connect_timeout": 10},
            pool_pre_ping=False,
        )
    return create_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def is_postgres() -> bool:
    return engine.dialect.name == "postgresql"


def init_db(drop: bool = False) -> None:
    """Cria o schema. Em PostgreSQL com TimescaleDB, converte as tabelas temporais em hypertables."""
    from app import models  # noqa: F401 - registra os modelos

    if drop and engine.dialect.name == "sqlite":
        engine.dispose()
        db_file = Path(engine.url.database or "")
        for suffix in ("", "-wal", "-shm"):
            Path(f"{db_file}{suffix}").unlink(missing_ok=True)
    elif drop:
        # O agregado contínuo do TimescaleDB depende de `measurement`: precisa cair antes das tabelas.
        with engine.begin() as conn:
            conn.execute(text("DROP MATERIALIZED VIEW IF EXISTS measurement_daily CASCADE"))
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    if is_postgres():
        _setup_timescale()


def _setup_timescale() -> None:
    """Aplica hypertables/compressão/agregado contínuo quando a extensão existe.

    Em PostgreSQL gerenciado sem TimescaleDB (ex.: Neon), a aplicação funciona normalmente:
    o repositório de séries usa SQL portável e a chave primária (variable_id, ts) atende as consultas.
    """
    sql_path = Path(__file__).resolve().parent.parent / "db" / "timescale" / "001_hypertables.sql"
    if not sql_path.exists():
        return
    with engine.begin() as conn:
        has_ts = conn.execute(
            text("SELECT count(*) FROM pg_available_extensions WHERE name = 'timescaledb'")
        ).scalar()
        if not has_ts:
            return
        conn.execute(text(sql_path.read_text(encoding="utf-8")))
