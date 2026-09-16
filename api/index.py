"""Ponto de entrada da API na Vercel (Python Serverless Function, runtime ASGI).

A Vercel roteia `/api/*`, `/docs`, `/openapi.json` e `/health` para este arquivo (ver vercel.json).
O caminho original da requisição chega intacto ao FastAPI, então as rotas continuam as mesmas do
ambiente local (`/api/...`).

Requisitos de ambiente (Project Settings → Environment Variables):
  EE_DATABASE_URL   postgresql+psycopg://usuario:senha@host-pooler.../banco?sslmode=require
  EE_JWT_SECRET     segredo forte
  EE_ENVIRONMENT    demo | prod
"""
import sys
from pathlib import Path

# O pacote da aplicação vive em backend/app (incluído no bundle por functions.includeFiles).
BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.main import app  # noqa: E402  (o sys.path precisa ser ajustado antes do import)

__all__ = ["app"]
