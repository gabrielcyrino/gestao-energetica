"""Ponto de entrada da API na Vercel (Python Serverless Function, runtime ASGI).

A Vercel roteia `/api/*`, `/docs`, `/openapi.json` e `/health` para este arquivo (ver vercel.json).
O caminho original da requisição chega intacto ao FastAPI, então as rotas continuam as mesmas do
ambiente local (`/api/...`).

Se a aplicação não conseguir subir (variável de ambiente faltando, pacote ausente no bundle...),
este módulo responde com um diagnóstico legível em vez de derrubar a função com
FUNCTION_INVOCATION_FAILED, que não diz nada a quem está publicando.

Variáveis de ambiente (Project Settings → Environment Variables):
  EE_DATABASE_URL   postgresql+psycopg://usuario:senha@host-pooler.../banco?sslmode=require
  EE_JWT_SECRET     segredo forte
  EE_ENVIRONMENT    demo | prod
"""
import json
import os
import sys
import traceback
from pathlib import Path

# O pacote da aplicação vive em backend/app (incluído no bundle por functions.includeFiles).
ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
for candidate in (BACKEND, ROOT):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

try:
    from app.main import app  # noqa: E402  (o sys.path precisa ser ajustado antes do import)
except Exception as exc:  # noqa: BLE001 - qualquer falha de carga vira diagnóstico HTTP
    _ERROR = exc
    _TRACE = traceback.format_exc()

    def _diagnosis() -> dict:
        db_url = os.getenv("EE_DATABASE_URL", "")
        hints: list[str] = []
        if not db_url:
            hints.append(
                "EE_DATABASE_URL não está definida no projeto Vercel. Configure-a (Production, Preview e "
                "Development) com a string do PostgreSQL gerenciado no formato "
                "postgresql+psycopg://usuario:senha@host-pooler.../banco?sslmode=require"
            )
        elif db_url.startswith("sqlite"):
            hints.append("EE_DATABASE_URL aponta para SQLite, que não funciona em ambiente serverless.")
        elif db_url.startswith("postgres://") or db_url.startswith("postgresql://"):
            hints.append(
                "EE_DATABASE_URL precisa do driver no prefixo: troque 'postgresql://' por "
                "'postgresql+psycopg://'."
            )
        if isinstance(_ERROR, ModuleNotFoundError):
            missing = getattr(_ERROR, "name", "")
            if missing == "app":
                hints.append(
                    "O pacote backend/app não foi enviado junto com a função. Confira "
                    "functions.\"api/index.py\".includeFiles no vercel.json e se .vercelignore não exclui backend/app."
                )
            else:
                hints.append(f"Dependência ausente no bundle: '{missing}'. Confira o requirements.txt da raiz.")
        if not os.getenv("EE_JWT_SECRET"):
            hints.append("EE_JWT_SECRET não está definida (necessária para emitir tokens).")
        return {
            "status": "error",
            "stage": "boot",
            "error": f"{type(_ERROR).__name__}: {_ERROR}",
            "hints": hints or ["Consulte os logs: vercel logs <projeto> --follow"],
            "environment": {
                "EE_DATABASE_URL": _mask(db_url),
                "EE_ENVIRONMENT": os.getenv("EE_ENVIRONMENT", "(não definida)"),
                "EE_JWT_SECRET": "definida" if os.getenv("EE_JWT_SECRET") else "(não definida)",
                "backend_no_bundle": BACKEND.is_dir(),
                "python": sys.version.split()[0],
            },
            "doc": "docs/08-deploy-vercel.md",
        }

    def _mask(url: str) -> str:
        if not url:
            return "(não definida)"
        if "@" in url and "://" in url:
            scheme, rest = url.split("://", 1)
            creds, host = rest.split("@", 1)
            user = creds.split(":", 1)[0]
            return f"{scheme}://{user}:***@{host}"
        return url

    def _payload() -> dict:
        return {**_diagnosis(), "traceback": _TRACE.splitlines()[-12:]}

    try:  # preferido: aplicação Starlette (reconhecida como ASGI pelo runtime da Vercel)
        from starlette.applications import Starlette
        from starlette.responses import JSONResponse
        from starlette.routing import Route

        async def _diag_endpoint(_request):
            return JSONResponse(_payload(), status_code=503, headers={"cache-control": "no-store"})

        app = Starlette(  # type: ignore[assignment]
            routes=[Route("/{path:path}", endpoint=_diag_endpoint, methods=["GET", "POST", "PUT", "DELETE"])]
        )
    except Exception:  # noqa: BLE001 - nem o Starlette está disponível: ASGI mínimo na mão

        async def app(scope, receive, send):  # type: ignore[misc]  # noqa: D103
            if scope["type"] != "http":
                return
            body = json.dumps(_payload(), ensure_ascii=False, indent=2).encode("utf-8")
            await send(
                {
                    "type": "http.response.start",
                    "status": 503,
                    "headers": [
                        (b"content-type", b"application/json; charset=utf-8"),
                        (b"cache-control", b"no-store"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})


__all__ = ["app"]
