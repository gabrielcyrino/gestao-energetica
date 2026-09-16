"""Contexto de períodos (Crop Years, safras e intervalo de dados disponíveis)."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.periods import NamedRange, PeriodContext
from app.engine.repository import SeriesRepository, cache
from app.models import CropYear, Season


def period_context(db: Session) -> PeriodContext:
    key = ("period_ctx",)
    hit = cache.get(key)
    if hit is not None:
        return hit
    cys = [NamedRange(c.code, c.name, c.start_date, c.end_date) for c in db.scalars(select(CropYear))]
    seasons = [NamedRange(s.code, s.name, s.start_date, s.end_date, s.season_type) for s in db.scalars(select(Season))]
    lo, hi = SeriesRepository(db).data_range()
    today = date.today()
    ctx = PeriodContext(cys, seasons, lo or today, hi or today)
    cache.set(key, ctx)
    return ctx
