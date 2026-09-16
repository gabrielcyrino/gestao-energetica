"""Configuração da aplicação (12-factor: tudo via variáveis de ambiente)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EE_", env_file=".env", extra="ignore")

    app_name: str = "Gestão Energética Conectada ao Processo"
    environment: str = "demo"  # demo | dev | prod

    # SQLite para demonstração local; PostgreSQL + TimescaleDB em produção:
    # EE_DATABASE_URL=postgresql+psycopg://energia:energia@localhost:5432/energia
    database_url: str = f"sqlite:///{(BASE_DIR / 'data' / 'energia_demo.db').as_posix()}"

    # Segurança. Em produção o segredo vem de um cofre (Azure Key Vault / Vault) e o
    # login é delegado ao IdP corporativo (OIDC). O modo demo emite tokens locais.
    jwt_secret: str = "troque-este-segredo-em-producao"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 8 * 60
    demo_auth: bool = True
    ingestion_api_key: str = "demo-ingestion-key"

    cors_origins: list[str] = ["http://localhost:6471", "http://127.0.0.1:6471", "http://localhost:6470"]

    # Unidade de referência para somar energias de fontes diferentes (energia final).
    reference_energy_unit: str = "MWh"

    # Cache de cálculos (segundos). Em produção: Redis.
    calc_cache_ttl: int = 300


@lru_cache
def get_settings() -> Settings:
    return Settings()
