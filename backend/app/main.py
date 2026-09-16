"""API da plataforma de Gestão Energética Conectada ao Processo.

Camadas: rotas (HTTP) → serviços (regras de negócio) → motor de cálculo → repositório (séries) → banco.
Documentação interativa: /docs (Swagger) e /redoc. Esquema OpenAPI: /openapi.json
"""
from __future__ import annotations

import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import routes_analysis, routes_assets, routes_core, routes_hierarchy, routes_indicators, routes_ops
from app.config import get_settings
from app.db import check_connection, config_error, engine
from app.engine.formula import FormulaError
from app.engine.periods import PeriodError
from app.engine.units import UnitError
from sqlalchemy.exc import OperationalError, ProgrammingError

settings = get_settings()

DESCRIPTION = """
API do dashboard de gestão energética conectada ao processo produtivo.

**Conceito**: Processo → Subprocesso → USE → Equipamento → Variável → Indicador (intrínseco e extrínseco)
→ desempenho → tendência → desvio → oportunidade.

A ISO 50001 é usada como **referencial metodológico** (não há objetivo de certificação).

⚠️ Ambiente DEMO: os dados são fictícios (MOCK DATA) gerados por simulação.
"""

app = FastAPI(
    title=settings.app_name,
    description=DESCRIPTION,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=[
        {"name": "Autenticação", "description": "Login, perfis e escopos de acesso."},
        {"name": "Metadados", "description": "Catálogos, períodos disponíveis e vocabulário de status."},
        {"name": "Hierarquia", "description": "Empresa → planta → área → processo → subprocesso e fluxogramas."},
        {"name": "USEs", "description": "Usos Significativos de Energia."},
        {"name": "Equipamentos", "description": "Equipamentos e dados de placa."},
        {"name": "Variáveis", "description": "Tags/sensores, séries brutas e qualidade do dado."},
        {"name": "Indicadores", "description": "IDEs configuráveis: fórmula, vínculos, metas, histórico."},
        {"name": "Linhas de base", "description": "Consumo esperado (regressão) e observado × esperado."},
        {"name": "Dashboard", "description": "Visão executiva consolidada."},
        {"name": "Comparações", "description": "Semana × semana, mês × mês, Crop Year, safra e períodos livres."},
        {"name": "Matrizes", "description": "Processo × USE, USE × indicador e matriz completa de IDEs."},
        {"name": "Tendências", "description": "Classificação de tendência, outliers e mudança de comportamento."},
        {"name": "Oportunidades", "description": "Registro e acompanhamento de oportunidades de melhoria."},
        {"name": "Ingestão", "description": "CSV e API de integração (gateway OPC UA/MQTT → API)."},
        {"name": "Auditoria", "description": "Trilha de auditoria das alterações."},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def timing_header(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Response-Time-ms"] = f"{(time.perf_counter() - t0) * 1000:.1f}"
    return response


@app.exception_handler(PeriodError)
async def period_error(_: Request, exc: PeriodError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(FormulaError)
async def formula_error(_: Request, exc: FormulaError):
    return JSONResponse(status_code=422, content={"detail": f"Fórmula inválida: {exc}"})


@app.exception_handler(UnitError)
async def unit_error(_: Request, exc: UnitError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


for module in (routes_core, routes_hierarchy, routes_assets, routes_indicators, routes_analysis, routes_ops):
    app.include_router(module.router, prefix="/api")


@app.exception_handler(OperationalError)
async def db_unavailable(_: Request, exc: OperationalError):
    return JSONResponse(
        status_code=503,
        content={"detail": f"Banco de dados indisponível: {str(exc.orig)[:300]}"},
    )


@app.exception_handler(ProgrammingError)
async def db_schema_error(_: Request, exc: ProgrammingError):
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Banco acessível, mas o schema da aplicação não está carregado. "
            "Rode a carga inicial: EE_DATABASE_URL=... python -m app.seed.run "
            f"(detalhe: {str(exc.orig)[:200]})"
        },
    )


@app.get("/health", tags=["Metadados"])
def health():
    """Diagnóstico de implantação: configuração, conexão com o banco e schema carregado."""
    db = check_connection()
    status = "ok" if db.get("schema_ready") else ("degraded" if db.get("connected") else "error")
    return {
        "status": status,
        "database": engine.dialect.name,
        "environment": settings.environment,
        "config_error": config_error(),
        **db,
    }
