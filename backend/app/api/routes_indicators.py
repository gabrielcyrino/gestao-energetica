"""IDEs: cadastro configurável, validação de fórmula, avaliação, histórico e linhas de base."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import CompareQ, PeriodQ, get_or_404, resolve_period, resolve_periods, row_to_dict
from app.api.lookup import Lookup
from app.api.schemas import BaselineFitIn, FormulaCheckIn, IndicatorIn, PreviewIn
from app.db import get_db
from app.engine import formula as fx
from app.engine.indicators import IndicatorEngine, change
from app.engine.periods import auto_grain
from app.engine.repository import SeriesRepository, cache
from app.models import (
    AppUser,
    EnergyBaseline,
    Equipment,
    HierarchyNode,
    Indicator,
    IndicatorBinding,
    IndicatorTarget,
    Opportunity,
    Variable,
)
from app.security import EDITORS, audit, ensure_can_edit_node, get_current_user, require_roles
from app.services import baselines as bl_service
from app.services.analysis import evaluation_rows, status_counts, window_start

router = APIRouter()


# ---------------------------------------------------------------------- listagem / matriz
@router.get("/indicators", tags=["Indicadores"])
def list_indicators(node_id: int | None = None, use_id: int | None = None, equipment_id: int | None = None,
                    kind: str | None = None, category: str | None = None, level: str | None = None,
                    search: str | None = None, evaluate: bool = True, spark: bool = False,
                    period: str | None = PeriodQ, compare: str | None = CompareQ,
                    db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    lk = Lookup(db)
    inds = IndicatorEngine.load_indicators(db)
    if node_id:
        node = get_or_404(db, HierarchyNode, node_id, "Nó")
        ids = {n.id for n in lk.nodes.values() if n.path.startswith(node.path)}
        inds = [i for i in inds if i.node_id in ids]
    if use_id:
        inds = [i for i in inds if i.use_id == use_id]
    if equipment_id:
        inds = [i for i in inds if i.equipment_id == equipment_id]
    if kind:
        inds = [i for i in inds if i.kind == kind]
    if category:
        inds = [i for i in inds if i.category == category]
    if level:
        inds = [i for i in inds if ("equipment" if i.equipment_id else "use" if i.use_id else "process") == level]
    if search:
        s = search.lower()
        inds = [i for i in inds if s in i.name.lower() or s in i.code.lower() or s in i.formula.lower()]
    if not evaluate:
        return {"items": [lk.indicator(i) for i in inds], "count": len(inds)}
    a, b = resolve_periods(db, period, compare)
    rows = evaluation_rows(db, lk, inds, a, b, spark=spark)
    return {"period": a.to_dict(), "comparison_period": b.to_dict(), "items": rows,
            "status_counts": status_counts(rows), "count": len(rows)}


@router.post("/evaluations", tags=["Indicadores"])
def evaluate_many(payload: dict = Body(...), db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    """Avaliação em lote por lista de ids (usada por matrizes e painéis)."""
    ids = payload.get("indicator_ids") or []
    a, b = resolve_periods(db, payload.get("period"), payload.get("compare"))
    lk = Lookup(db)
    inds = IndicatorEngine.load_indicators(db, ids)
    rows = evaluation_rows(db, lk, inds, a, b, spark=bool(payload.get("spark")))
    return {"period": a.to_dict(), "comparison_period": b.to_dict(), "items": rows}


# ---------------------------------------------------------------------- detalhe / análise
@router.get("/indicators/{indicator_id}", tags=["Indicadores"])
def get_indicator(indicator_id: int, period: str | None = PeriodQ, compare: str | None = CompareQ,
                  db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    ind = _load(db, indicator_id)
    a, b = resolve_periods(db, period, compare)
    lk = Lookup(db)
    engine = IndicatorEngine(db)
    ea = engine.evaluate([ind], a)[ind.id]
    eb = engine.evaluate([ind], b)[ind.id]
    lk.variables  # pré-carrega catálogo
    opportunities = db.scalars(select(Opportunity).where(Opportunity.indicator_id == ind.id))
    return {
        "indicator": lk.indicator(ind, detail=True),
        "period": a.to_dict(), "comparison_period": b.to_dict(),
        "current": ea.to_dict(), "previous": eb.to_dict(),
        **change(ind, ea.value, eb.value),
        "opportunities": [{"id": o.id, "code": o.code, "title": o.title, "status": o.status, "priority": o.priority}
                          for o in opportunities],
    }


@router.get("/indicators/{indicator_id}/history", tags=["Indicadores"])
def indicator_history(indicator_id: int, period: str | None = PeriodQ, grain: str | None = None,
                      window: int | None = Query(None, description="Nº de buckets encerrando no fim do período"),
                      start: date | None = None, end: date | None = None, ma_window: int | None = None,
                      db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    ind = _load(db, indicator_id)
    a = resolve_period(db, period)
    if start is None or end is None:
        end = a.eff_end
        if window:
            grain = grain or "week"
            start = window_start(end, grain, window)
        else:
            start, end = a.eff_start, a.eff_end
    grain = grain or auto_grain(start, end)
    engine = IndicatorEngine(db)
    hist = engine.history(ind, start, end, grain, ma_window)
    lk = Lookup(db)
    return {"indicator": lk.indicator(ind), "start": start.isoformat(), "end": end.isoformat(),
            "period": a.to_dict(), **hist}


@router.get("/indicators/{indicator_id}/components", tags=["Indicadores"])
def indicator_components(indicator_id: int, period: str | None = PeriodQ, compare: str | None = CompareQ,
                         grain: str = "day", db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    """Séries diárias dos símbolos da fórmula — base dos gráficos energia × produção."""
    ind = _load(db, indicator_id)
    a, b = resolve_periods(db, period, compare)
    engine = IndicatorEngine(db)
    lk = Lookup(db)
    out = {}
    for label, p in (("current", a), ("previous", b)):
        pts = engine.series(ind, p.eff_start, p.eff_end, grain)
        out[label] = {"period": p.to_dict(), "points": pts}
    symbols = {b_.symbol: {"variable": lk.variable(lk.variables[b_.variable_id]) if b_.variable_id in lk.variables else None,
                           "source_type": b_.source_type, "aggregation": b_.aggregation}
               for b_ in ind.bindings}
    return {"indicator": lk.indicator(ind), "symbols": symbols, **out}


@router.get("/indicators/{indicator_id}/quality", tags=["Indicadores"])
def indicator_quality(indicator_id: int, period: str | None = PeriodQ, db: Session = Depends(get_db),
                      _: AppUser = Depends(get_current_user)):
    ind = _load(db, indicator_id)
    a = resolve_period(db, period)
    lk = Lookup(db)
    repo = SeriesRepository(db)
    ids = [b.variable_id for b in ind.bindings if b.variable_id]
    aggs = repo.period_aggregates(ids, a.eff_start, a.eff_end)
    quality = repo.quality_breakdown(ids, a.eff_start, a.eff_end)
    last = repo.last_update(ids)
    items = []
    for b in ind.bindings:
        if not b.variable_id:
            continue
        v = lk.variables[b.variable_id]
        agg = aggs.get(v.id)
        q = quality.get(v.id, {})
        total = sum(q.values()) or 0
        items.append({
            "symbol": b.symbol, **lk.variable(v),
            "days_with_data": agg.days if agg else 0, "expected_days": a.days,
            "completeness_pct": round(min(100.0, (agg.days if agg else 0) / a.days * 100), 1) if a.days else 0,
            "quality_breakdown": q,
            "suspect_or_bad_pct": round((q.get("bad", 0) + q.get("suspect", 0)) / total * 100, 2) if total else 0.0,
            "last_value_at": last.get(v.id).isoformat() if last.get(v.id) else None,
        })
    return {"period": a.to_dict(), "min_completeness_pct": ind.min_completeness_pct, "items": items,
            "note": "Dias sem leitura não são tratados como zero: reduzem a completude e podem invalidar o período."}


# ---------------------------------------------------------------------- cadastro
@router.post("/indicators/validate", tags=["Indicadores"])
def validate_formula(body: FormulaCheckIn, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    try:
        compiled = fx.compile_formula(body.formula)
    except fx.FormulaError as exc:
        return {"valid": False, "errors": [str(exc)], "symbols": []}
    bound = {b.symbol for b in body.bindings}
    errors = []
    missing = sorted(compiled.symbols - bound)
    if missing:
        errors.append(f"Símbolos sem vínculo: {', '.join(missing)}")
    unused = sorted(bound - compiled.symbols)
    for b in body.bindings:
        if b.source_type == "variable" and not b.variable_id:
            errors.append(f"Vínculo '{b.symbol}': selecione a variável.")
        if b.source_type == "constant" and b.constant_value is None:
            errors.append(f"Vínculo '{b.symbol}': informe o valor da constante.")
        if b.source_type == "builtin" and not b.builtin:
            errors.append(f"Vínculo '{b.symbol}': selecione a função do período.")
        if b.source_type == "equipment_attribute" and not b.attribute:
            errors.append(f"Vínculo '{b.symbol}': informe o atributo do equipamento.")
    return {"valid": not errors, "errors": errors, "symbols": sorted(compiled.symbols), "unused_bindings": unused}


@router.post("/indicators/preview", tags=["Indicadores"])
def preview_indicator(body: PreviewIn, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    """Calcula um indicador ainda não salvo (usado pelo cadastro para conferir a fórmula com dados reais)."""
    a = resolve_period(db, body.period)
    ind = _build_indicator(db, Indicator(), body, transient=True)  # objeto transitório: nada é persistido
    ev = IndicatorEngine(db).evaluate([ind], a)[ind.id]
    return {"period": a.to_dict(), "evaluation": ev.to_dict()}


@router.post("/indicators", tags=["Indicadores"], status_code=201)
def create_indicator(body: IndicatorIn, request: Request, db: Session = Depends(get_db),
                     user: AppUser = Depends(get_current_user)):
    ensure_can_edit_node(db, user, body.node_id)
    if db.scalar(select(Indicator).where(Indicator.code == body.code)):
        raise HTTPException(409, f"Já existe indicador com o código '{body.code}'.")
    ind = _build_indicator(db, Indicator(), body)
    db.add(ind)
    db.flush()
    audit(db, user, "create", "indicator", ind.id, after=row_to_dict(ind), request=request)
    db.commit()
    cache.invalidate()
    return Lookup(db).indicator(_load(db, ind.id), detail=True)


@router.put("/indicators/{indicator_id}", tags=["Indicadores"])
def update_indicator(indicator_id: int, body: IndicatorIn, request: Request, db: Session = Depends(get_db),
                     user: AppUser = Depends(get_current_user)):
    ind = _load(db, indicator_id)
    ensure_can_edit_node(db, user, ind.node_id)
    ensure_can_edit_node(db, user, body.node_id)
    before = row_to_dict(ind)
    _build_indicator(db, ind, body)
    db.flush()
    audit(db, user, "update", "indicator", ind.id, before, row_to_dict(ind), request)
    db.commit()
    cache.invalidate()
    return Lookup(db).indicator(_load(db, ind.id), detail=True)


@router.delete("/indicators/{indicator_id}", tags=["Indicadores"], status_code=204)
def delete_indicator(indicator_id: int, request: Request, db: Session = Depends(get_db),
                     user: AppUser = Depends(get_current_user)):
    ind = _load(db, indicator_id)
    ensure_can_edit_node(db, user, ind.node_id)
    audit(db, user, "delete", "indicator", ind.id, row_to_dict(ind), None, request)
    db.execute(Opportunity.__table__.update().where(Opportunity.indicator_id == ind.id).values(indicator_id=None))
    db.delete(ind)
    db.commit()
    cache.invalidate()


def _load(db: Session, indicator_id: int) -> Indicator:
    ind = db.get(Indicator, indicator_id)
    if ind is None:
        raise HTTPException(404, "Indicador não encontrado.")
    return ind


def _build_indicator(db: Session, ind: Indicator, body: IndicatorIn, transient: bool = False) -> Indicator:
    try:
        compiled = fx.compile_formula(body.formula)
    except fx.FormulaError as exc:
        raise HTTPException(422, f"Fórmula inválida: {exc}") from None
    symbols = {b.symbol for b in body.bindings}
    missing = compiled.symbols - symbols
    if missing:
        raise HTTPException(422, f"Símbolos sem vínculo: {', '.join(sorted(missing))}")
    for b in body.bindings:
        if b.source_type == "variable" and (b.variable_id is None or db.get(Variable, b.variable_id) is None):
            raise HTTPException(422, f"Vínculo '{b.symbol}': variável inexistente.")
    if body.equipment_id and db.get(Equipment, body.equipment_id) is None:
        raise HTTPException(422, "Equipamento inexistente.")
    data = body.model_dump(exclude={"bindings", "targets", "status_rule"})
    data.pop("period", None)
    for k, v in data.items():
        setattr(ind, k, v)
    ind.status_rule = body.status_rule.model_dump()
    ind.bindings = [IndicatorBinding(**b.model_dump()) for b in body.bindings]
    if body.targets or not transient:
        ind.targets = [IndicatorTarget(**t.model_dump()) for t in body.targets]
    if transient:
        ind.id = ind.id or -1
    return ind


# ---------------------------------------------------------------------- linhas de base
@router.get("/baselines", tags=["Linhas de base"])
def list_baselines(node_id: int | None = None, db: Session = Depends(get_db),
                   _: AppUser = Depends(get_current_user)):
    lk = Lookup(db)
    items = list(lk.baselines.values())
    if node_id:
        node = get_or_404(db, HierarchyNode, node_id, "Nó")
        ids = {n.id for n in lk.nodes.values() if n.path.startswith(node.path)}
        items = [b for b in items if b.node_id in ids]
    return [lk.baseline(b) for b in items]


@router.get("/baselines/{baseline_id}", tags=["Linhas de base"])
def get_baseline(baseline_id: int, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    b = get_or_404(db, EnergyBaseline, baseline_id, "Linha de base")
    return Lookup(db).baseline(b)


@router.get("/baselines/{baseline_id}/evaluate", tags=["Linhas de base"])
def evaluate_baseline(baseline_id: int, period: str | None = PeriodQ, grain: str | None = None,
                      window: int | None = None, db: Session = Depends(get_db),
                      _: AppUser = Depends(get_current_user)):
    b = get_or_404(db, EnergyBaseline, baseline_id, "Linha de base")
    a = resolve_period(db, period)
    if window:
        grain = grain or "week"
        start, end = window_start(a.eff_end, grain, window), a.eff_end
    else:
        start, end = a.eff_start, a.eff_end
        grain = grain or auto_grain(start, end)
    lk = Lookup(db)
    return {"baseline": lk.baseline(b), "period": a.to_dict(), **bl_service.evaluate(db, b, start, end, grain)}


@router.post("/baselines/{baseline_id}/fit", tags=["Linhas de base"])
def fit_baseline(baseline_id: int, body: BaselineFitIn, request: Request, db: Session = Depends(get_db),
                 user: AppUser = Depends(require_roles(*EDITORS))):
    b = get_or_404(db, EnergyBaseline, baseline_id, "Linha de base")
    before = row_to_dict(b)
    try:
        bl_service.fit(db, b, body.variables, body.period_start, body.period_end)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    audit(db, user, "fit", "energy_baseline", b.id, before, row_to_dict(b), request)
    db.commit()
    cache.invalidate()
    return Lookup(db).baseline(b)
