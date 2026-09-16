"""Utilitários compartilhados pelas rotas: resolução de períodos, serialização e snapshot de entidades."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException, Query
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.engine.periods import PeriodError, ResolvedPeriod
from app.services.context import period_context


def resolve_periods(db: Session, period: str | None, compare: str | None) -> tuple[ResolvedPeriod, ResolvedPeriod]:
    ctx = period_context(db)
    try:
        a = ctx.resolve(period or ctx.default_spec())
        b = ctx.comparison(a, compare)
    except PeriodError as exc:
        raise HTTPException(422, str(exc)) from None
    return a, b


def resolve_period(db: Session, period: str | None) -> ResolvedPeriod:
    ctx = period_context(db)
    try:
        return ctx.resolve(period or ctx.default_spec())
    except PeriodError as exc:
        raise HTTPException(422, str(exc)) from None


PeriodQ = Query(None, description="Período: week:2026-W32 | month:2026-08 | year:2026 | crop_year:CY2026 | "
                                   "season:SV2026 | custom:2026-08-01..2026-08-31 | last:30")
CompareQ = Query(None, description="prev (período anterior) | yoy (mesmo período do ano anterior) | outra especificação")


def row_to_dict(obj) -> dict:
    """Snapshot das colunas de uma entidade ORM (auditoria e respostas simples)."""
    out = {}
    for col in inspect(obj).mapper.column_attrs:
        v = getattr(obj, col.key)
        out[col.key] = v.isoformat() if isinstance(v, (date, datetime)) else v
    return out


def get_or_404(db: Session, model, id_: int, what: str = "Registro"):
    obj = db.get(model, id_)
    if obj is None:
        raise HTTPException(404, f"{what} não encontrado.")
    return obj


def apply_payload(obj, data: dict, exclude: set[str] = frozenset()) -> None:
    for k, v in data.items():
        if k in exclude:
            continue
        if hasattr(obj, k):
            setattr(obj, k, v)
