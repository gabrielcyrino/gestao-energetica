"""Acesso às séries temporais com agregação no banco.

Portável (SQLite/PostgreSQL). Em TimescaleDB o mesmo contrato pode ler do agregado contínuo
`measurement_daily`. Leituras de qualidade 'bad' e valores NULL não entram nos cálculos e
reduzem a completude — nunca são convertidos em zero.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.models import Measurement

VALID = (Measurement.value.isnot(None), Measurement.quality != "bad")


@dataclass(frozen=True)
class DailyStat:
    sum: float
    avg: float
    min: float
    max: float
    n: int


@dataclass(frozen=True)
class PeriodAgg:
    sum: float
    avg: float
    min: float
    max: float
    n: int
    days: int
    last_ts: datetime | None


def _to_date(v) -> date:
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    return date.fromisoformat(str(v)[:10])


def _bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return datetime.combine(start, datetime.min.time()), datetime.combine(end + timedelta(days=1), datetime.min.time())


class _TTLCache:
    """Cache em memória por processo. Em produção substituído por Redis (chave inclui data_version)."""

    def __init__(self, ttl: int = 300, max_items: int = 2048):
        self.ttl, self.max_items = ttl, max_items
        self._data: dict = {}
        self._lock = threading.Lock()
        self.data_version = 0

    def get(self, key):
        with self._lock:
            item = self._data.get((self.data_version, key))
            if item and item[0] > time.monotonic():
                return item[1]
            return None

    def set(self, key, value):
        with self._lock:
            if len(self._data) >= self.max_items:
                self._data.clear()
            self._data[(self.data_version, key)] = (time.monotonic() + self.ttl, value)

    def invalidate(self):
        with self._lock:
            self.data_version += 1
            self._data.clear()


cache = _TTLCache()


class SeriesRepository:
    def __init__(self, db: Session):
        self.db = db

    def period_aggregates(self, variable_ids: list[int], start: date, end: date) -> dict[int, PeriodAgg]:
        ids = sorted(set(variable_ids))
        if not ids or end < start:
            return {}
        key = ("agg", tuple(ids), start, end)
        hit = cache.get(key)
        if hit is not None:
            return hit
        t0, t1 = _bounds(start, end)
        m = Measurement
        rows = self.db.execute(
            select(
                m.variable_id,
                func.sum(m.value),
                func.avg(m.value),
                func.min(m.value),
                func.max(m.value),
                func.count(m.value),
                func.count(distinct(func.date(m.ts))),
                func.max(m.ts),
            )
            .where(m.variable_id.in_(ids), m.ts >= t0, m.ts < t1, *VALID)
            .group_by(m.variable_id)
        ).all()
        out = {
            r[0]: PeriodAgg(float(r[1]), float(r[2]), float(r[3]), float(r[4]), int(r[5]), int(r[6]), r[7])
            for r in rows
            if r[5]
        }
        cache.set(key, out)
        return out

    def daily(self, variable_ids: list[int], start: date, end: date) -> dict[int, dict[date, DailyStat]]:
        ids = sorted(set(variable_ids))
        if not ids or end < start:
            return {}
        key = ("daily", tuple(ids), start, end)
        hit = cache.get(key)
        if hit is not None:
            return hit
        t0, t1 = _bounds(start, end)
        m = Measurement
        day = func.date(m.ts)
        rows = self.db.execute(
            select(
                m.variable_id, day, func.sum(m.value), func.avg(m.value), func.min(m.value), func.max(m.value),
                func.count(m.value),
            )
            .where(m.variable_id.in_(ids), m.ts >= t0, m.ts < t1, *VALID)
            .group_by(m.variable_id, day)
        ).all()
        out: dict[int, dict[date, DailyStat]] = {i: {} for i in ids}
        for vid, d, s, a, mn, mx, n in rows:
            if n:
                out[vid][_to_date(d)] = DailyStat(float(s), float(a), float(mn), float(mx), int(n))
        cache.set(key, out)
        return out

    def last_values(self, variable_ids: list[int], start: date, end: date) -> dict[int, float]:
        ids = sorted(set(variable_ids))
        if not ids:
            return {}
        t0, t1 = _bounds(start, end)
        m = Measurement
        sub = (
            select(m.variable_id, func.max(m.ts).label("mts"))
            .where(m.variable_id.in_(ids), m.ts >= t0, m.ts < t1, *VALID)
            .group_by(m.variable_id)
            .subquery()
        )
        rows = self.db.execute(
            select(m.variable_id, m.value).join(sub, (m.variable_id == sub.c.variable_id) & (m.ts == sub.c.mts))
        ).all()
        return {vid: float(v) for vid, v in rows if v is not None}

    def quality_breakdown(self, variable_ids: list[int], start: date, end: date) -> dict[int, dict[str, int]]:
        ids = sorted(set(variable_ids))
        if not ids:
            return {}
        t0, t1 = _bounds(start, end)
        m = Measurement
        rows = self.db.execute(
            select(m.variable_id, m.quality, func.count())
            .where(m.variable_id.in_(ids), m.ts >= t0, m.ts < t1)
            .group_by(m.variable_id, m.quality)
        ).all()
        out: dict[int, dict[str, int]] = {}
        for vid, q, n in rows:
            out.setdefault(vid, {})[q] = int(n)
        return out

    def last_update(self, variable_ids: list[int]) -> dict[int, datetime]:
        ids = sorted(set(variable_ids))
        if not ids:
            return {}
        m = Measurement
        rows = self.db.execute(
            select(m.variable_id, func.max(m.ts), func.max(m.ingested_at)).where(m.variable_id.in_(ids)).group_by(m.variable_id)
        ).all()
        return {vid: ts for vid, ts, _ in rows}

    def data_range(self) -> tuple[date | None, date | None]:
        m = Measurement
        lo, hi = self.db.execute(select(func.min(m.ts), func.max(m.ts))).one()
        return (_to_date(lo) if lo else None, _to_date(hi) if hi else None)
