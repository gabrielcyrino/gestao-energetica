"""Linha de base energética por regressão: consumo esperado = a + Σ b_i · variável_relevante_i.

Ajuste em dias de operação do período de referência; avaliação compara observado × esperado e
acumula a diferença (CUSUM). Critérios de aceitação usuais (ex.: ASHRAE Guideline 14 / IPMVP) são
reportados como informação, não como bloqueio: R² e CV(RMSE).
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.periods import bucket_label, iter_buckets
from app.engine.repository import SeriesRepository
from app.engine.stats import fit_linear_regression
from app.models import EnergyBaseline, Unit, Variable


def _daily_values(db: Session, bl: EnergyBaseline, variables: dict[str, int], start: date, end: date):
    repo = SeriesRepository(db)
    ids = [bl.energy_variable_id, *variables.values()]
    if bl.operating_filter_variable_id:
        ids.append(bl.operating_filter_variable_id)
    daily = repo.daily(ids, start, end)
    aggregation = dict(db.execute(select(Variable.id, Variable.aggregation).where(Variable.id.in_(ids))).all())

    def val(vid: int, day: date):
        st = daily.get(vid, {}).get(day)
        if st is None:
            return None
        return st.avg if aggregation.get(vid) == "avg" else st.sum

    days = sorted(daily.get(bl.energy_variable_id, {}))
    rows = []
    for day in days:
        if bl.operating_filter_variable_id:
            op = val(bl.operating_filter_variable_id, day)
            if not op or op <= 0:
                continue
        xs = {s: val(v, day) for s, v in variables.items()}
        if any(x is None for x in xs.values()):
            continue
        rows.append((day, val(bl.energy_variable_id, day), xs))
    return rows


def fit(db: Session, bl: EnergyBaseline, variables: dict[str, int] | None = None,
        start: date | None = None, end: date | None = None) -> dict:
    variables = variables or {k: int(v) for k, v in (bl.model or {}).get("variables", {}).items()}
    if not variables:
        raise ValueError("Informe ao menos uma variável relevante.")
    start, end = start or bl.period_start, end or bl.period_end
    rows = _daily_values(db, bl, variables, start, end)
    y = [r[1] for r in rows]
    x = {s: [r[2][s] for r in rows] for s in variables}
    res = fit_linear_regression(y, x)
    bl.period_start, bl.period_end = start, end
    bl.model = {
        "variables": variables,
        "intercept": res.intercept,
        "coefficients": res.coefficients,
        "r2": res.r2,
        "adj_r2": res.adj_r2,
        "cv_rmse_pct": res.cv_rmse_pct,
        "n": res.n,
        "t_stats": res.t_stats,
        "acceptance": {
            "r2_ok": res.r2 >= 0.75,
            "cv_rmse_ok": res.cv_rmse_pct <= 25.0,
            "note": "Referência diária: R² ≥ 0,75 e CV(RMSE) ≤ 25% (adaptado de ASHRAE G14).",
        },
    }
    return bl.model


def evaluate(db: Session, bl: EnergyBaseline, start: date, end: date, grain: str) -> dict:
    model = bl.model or {}
    variables = {k: int(v) for k, v in model.get("variables", {}).items()}
    rows = _daily_values(db, bl, variables, start, end)
    coef = model.get("coefficients", {})
    by_day = {}
    for day, obs, xs in rows:
        exp = model.get("intercept", 0.0) + sum(coef.get(s, 0.0) * xs[s] for s in variables)
        by_day[day] = (obs, exp, xs)
    points, cusum = [], 0.0
    tot_obs = tot_exp = 0.0
    for b0, b1 in iter_buckets(start, end, grain):
        vals = [(o, e) for d, (o, e, _) in by_day.items() if b0 <= d <= b1]
        if not vals:
            points.append({"start": b0.isoformat(), "end": b1.isoformat(), "label": bucket_label(b0, grain),
                           "observed": None, "expected": None, "difference": None, "cusum": cusum, "days": 0})
            continue
        o = sum(v[0] for v in vals)
        e = sum(v[1] for v in vals)
        cusum += o - e
        tot_obs += o
        tot_exp += e
        points.append({"start": b0.isoformat(), "end": b1.isoformat(), "label": bucket_label(b0, grain),
                       "observed": o, "expected": e, "difference": o - e,
                       "difference_pct": (o - e) / e * 100 if e else None, "cusum": cusum, "days": len(vals)})
    var = db.get(Variable, bl.energy_variable_id)
    unit = db.get(Unit, var.unit_id).symbol if var else None
    scatter = [{"date": d.isoformat(), "observed": o, "expected": e, **{f"x_{k}": v for k, v in xs.items()}}
               for d, (o, e, xs) in sorted(by_day.items())]
    return {
        "baseline_id": bl.id,
        "unit": unit,
        "grain": grain,
        "points": points,
        "daily": scatter[-400:],
        "total_observed": tot_obs,
        "total_expected": tot_exp,
        "savings": tot_exp - tot_obs,
        "savings_pct": (tot_exp - tot_obs) / tot_exp * 100 if tot_exp else None,
        "operating_days": len(by_day),
    }
