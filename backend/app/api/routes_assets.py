"""USEs, equipamentos e variáveis (tags), incluindo séries brutas e qualidade do dado."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import CompareQ, PeriodQ, get_or_404, resolve_period, resolve_periods, row_to_dict
from app.api.lookup import Lookup
from app.api.schemas import EquipmentIn, UseIn, VariableIn
from app.db import get_db
from app.engine.indicators import IndicatorEngine
from app.engine.periods import auto_grain, bucket_label, iter_buckets
from app.engine.repository import SeriesRepository, cache
from app.models import AppUser, Equipment, HierarchyNode, Indicator, SignificantEnergyUse, Variable
from app.security import EDITORS, audit, ensure_can_edit_node, get_current_user, require_roles
from app.services.analysis import evaluation_rows, status_counts
from app.services.energy import EnergyService

router = APIRouter()


# ---------------------------------------------------------------------- USEs
@router.get("/uses", tags=["USEs"])
def list_uses(node_id: int | None = None, category_id: int | None = None, carrier_id: int | None = None,
              period: str | None = PeriodQ, compare: str | None = CompareQ, with_energy: bool = False,
              db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    lk = Lookup(db)
    uses = list(lk.uses.values())
    if node_id:
        node = get_or_404(db, HierarchyNode, node_id, "Nó")
        ids = {n.id for n in lk.nodes.values() if n.path.startswith(node.path)}
        uses = [u for u in uses if u.node_id in ids]
    if category_id:
        uses = [u for u in uses if u.category_id == category_id]
    if carrier_id:
        uses = [u for u in uses if u.energy_carrier_id == carrier_id]
    items = [lk.use(u) for u in sorted(uses, key=lambda u: (lk.nodes[u.node_id].path, u.code))]
    if with_energy:
        a, b = resolve_periods(db, period, compare)
        energy = EnergyService(db)
        plant = next(n for n in lk.nodes.values() if n.level == "plant")
        cur = {u["use_id"]: u for u in energy.by_use(plant, a)["uses"]}
        prev = {u["use_id"]: u["mwh"] for u in energy.by_use(plant, b)["uses"]}
        for it in items:
            c = cur.get(it["id"])
            it["mwh"] = c["mwh"] if c else None
            it["share_pct"] = c["share_pct"] if c else None
            it["previous_mwh"] = prev.get(it["id"])
            it["delta_pct"] = ((it["mwh"] - it["previous_mwh"]) / it["previous_mwh"] * 100
                               if it["mwh"] is not None and it["previous_mwh"] else None)
    return items


@router.get("/uses/{use_id}", tags=["USEs"])
def get_use(use_id: int, period: str | None = PeriodQ, compare: str | None = CompareQ,
            db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    use = get_or_404(db, SignificantEnergyUse, use_id, "USE")
    a, b = resolve_periods(db, period, compare)
    lk = Lookup(db)
    energy = EnergyService(db)
    node = lk.nodes[use.node_id]
    by_eq_a = energy.by_equipment(use, a)
    by_eq_b = energy.by_equipment(use, b)
    inds = [i for i in IndicatorEngine.load_indicators(db) if i.use_id == use.id]
    rows = evaluation_rows(db, lk, inds, a, b, spark=True)
    detail = lk.use(use, detail=True)
    for e in detail["equipment"]:
        e["mwh"] = by_eq_a.get(e["id"])
        e["previous_mwh"] = by_eq_b.get(e["id"])
        e["delta_pct"] = ((e["mwh"] - e["previous_mwh"]) / e["previous_mwh"] * 100
                          if e["mwh"] is not None and e["previous_mwh"] else None)
    total = sum(v for v in by_eq_a.values() if v) or None
    node_total = energy.summary(node, a)
    return {
        "use": detail, "period": a.to_dict(), "comparison_period": b.to_dict(),
        "energy_mwh": total, "previous_mwh": sum(v for v in by_eq_b.values() if v) or None,
        "share_of_node_pct": (total / node_total["energy_mwh"] * 100
                              if total and node_total.get("energy_mwh") else None),
        "node_energy": node_total,
        "indicators": rows, "status_counts": status_counts(rows),
    }


@router.post("/uses", tags=["USEs"], status_code=201)
def create_use(body: UseIn, request: Request, db: Session = Depends(get_db), user: AppUser = Depends(get_current_user)):
    ensure_can_edit_node(db, user, body.node_id)
    if db.scalar(select(SignificantEnergyUse).where(SignificantEnergyUse.code == body.code)):
        raise HTTPException(409, f"Já existe um USE com o código '{body.code}'.")
    obj = SignificantEnergyUse(**body.model_dump())
    db.add(obj)
    db.flush()
    audit(db, user, "create", "significant_energy_use", obj.id, after=row_to_dict(obj), request=request)
    db.commit()
    cache.invalidate()
    return Lookup(db).use(obj)


@router.put("/uses/{use_id}", tags=["USEs"])
def update_use(use_id: int, body: UseIn, request: Request, db: Session = Depends(get_db),
               user: AppUser = Depends(get_current_user)):
    obj = get_or_404(db, SignificantEnergyUse, use_id, "USE")
    ensure_can_edit_node(db, user, obj.node_id)
    ensure_can_edit_node(db, user, body.node_id)
    before = row_to_dict(obj)
    for k, v in body.model_dump().items():
        setattr(obj, k, v)
    db.flush()
    audit(db, user, "update", "significant_energy_use", obj.id, before, row_to_dict(obj), request)
    db.commit()
    cache.invalidate()
    return Lookup(db).use(obj)


@router.delete("/uses/{use_id}", tags=["USEs"], status_code=204)
def delete_use(use_id: int, request: Request, db: Session = Depends(get_db),
               user: AppUser = Depends(require_roles(*EDITORS))):
    obj = get_or_404(db, SignificantEnergyUse, use_id, "USE")
    if db.scalar(select(Equipment.id).where(Equipment.use_id == use_id).limit(1)):
        raise HTTPException(409, "Remova primeiro os equipamentos deste USE.")
    audit(db, user, "delete", "significant_energy_use", obj.id, row_to_dict(obj), None, request)
    db.delete(obj)
    db.commit()
    cache.invalidate()


# ---------------------------------------------------------------------- equipamentos
@router.get("/equipment", tags=["Equipamentos"])
def list_equipment(use_id: int | None = None, node_id: int | None = None, db: Session = Depends(get_db),
                   _: AppUser = Depends(get_current_user)):
    lk = Lookup(db)
    items = list(lk.equipment.values())
    if use_id:
        items = [e for e in items if e.use_id == use_id]
    if node_id:
        node = get_or_404(db, HierarchyNode, node_id, "Nó")
        ids = {n.id for n in lk.nodes.values() if n.path.startswith(node.path)}
        items = [e for e in items if lk.uses[e.use_id].node_id in ids]
    return [lk.equipment_item(e) for e in sorted(items, key=lambda e: e.tag)]


@router.get("/equipment/{equipment_id}", tags=["Equipamentos"])
def get_equipment(equipment_id: int, period: str | None = PeriodQ, compare: str | None = CompareQ,
                  db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    eq = get_or_404(db, Equipment, equipment_id, "Equipamento")
    a, b = resolve_periods(db, period, compare)
    lk = Lookup(db)
    inds = [i for i in IndicatorEngine.load_indicators(db) if i.equipment_id == eq.id]
    rows = evaluation_rows(db, lk, inds, a, b, spark=True)
    energy = EnergyService(db)
    use = lk.uses[eq.use_id]
    return {
        "equipment": lk.equipment_item(eq, detail=True),
        "use": lk.use(use),
        "period": a.to_dict(), "comparison_period": b.to_dict(),
        "energy_mwh": energy.by_equipment(use, a).get(eq.id),
        "previous_mwh": energy.by_equipment(use, b).get(eq.id),
        "indicators": rows, "status_counts": status_counts(rows),
    }


@router.post("/equipment", tags=["Equipamentos"], status_code=201)
def create_equipment(body: EquipmentIn, request: Request, db: Session = Depends(get_db),
                     user: AppUser = Depends(get_current_user)):
    use = get_or_404(db, SignificantEnergyUse, body.use_id, "USE")
    ensure_can_edit_node(db, user, use.node_id)
    if db.scalar(select(Equipment).where(Equipment.tag == body.tag)):
        raise HTTPException(409, f"Já existe equipamento com a TAG '{body.tag}'.")
    obj = Equipment(**body.model_dump())
    db.add(obj)
    db.flush()
    audit(db, user, "create", "equipment", obj.id, after=row_to_dict(obj), request=request)
    db.commit()
    cache.invalidate()
    return Lookup(db).equipment_item(obj)


@router.put("/equipment/{equipment_id}", tags=["Equipamentos"])
def update_equipment(equipment_id: int, body: EquipmentIn, request: Request, db: Session = Depends(get_db),
                     user: AppUser = Depends(get_current_user)):
    obj = get_or_404(db, Equipment, equipment_id, "Equipamento")
    ensure_can_edit_node(db, user, db.get(SignificantEnergyUse, obj.use_id).node_id)
    before = row_to_dict(obj)
    for k, v in body.model_dump().items():
        setattr(obj, k, v)
    db.flush()
    audit(db, user, "update", "equipment", obj.id, before, row_to_dict(obj), request)
    db.commit()
    cache.invalidate()
    return Lookup(db).equipment_item(obj)


@router.delete("/equipment/{equipment_id}", tags=["Equipamentos"], status_code=204)
def delete_equipment(equipment_id: int, request: Request, db: Session = Depends(get_db),
                     user: AppUser = Depends(require_roles(*EDITORS))):
    obj = get_or_404(db, Equipment, equipment_id, "Equipamento")
    if db.scalar(select(Indicator.id).where(Indicator.equipment_id == equipment_id).limit(1)):
        raise HTTPException(409, "Existem indicadores vinculados a este equipamento.")
    audit(db, user, "delete", "equipment", obj.id, row_to_dict(obj), None, request)
    db.delete(obj)
    db.commit()
    cache.invalidate()


# ---------------------------------------------------------------------- variáveis / tags
@router.get("/variables", tags=["Variáveis"])
def list_variables(node_id: int | None = None, equipment_id: int | None = None, variable_type: str | None = None,
                   search: str | None = None, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    lk = Lookup(db)
    items = list(lk.variables.values())
    if node_id:
        node = get_or_404(db, HierarchyNode, node_id, "Nó")
        ids = {n.id for n in lk.nodes.values() if n.path.startswith(node.path)}
        items = [v for v in items if v.node_id in ids]
    if equipment_id:
        items = [v for v in items if v.equipment_id == equipment_id]
    if variable_type:
        items = [v for v in items if v.variable_type == variable_type]
    if search:
        s = search.lower()
        items = [v for v in items if s in v.code.lower() or s in v.name.lower() or s in (v.source_tag or "").lower()]
    return [lk.variable(v) for v in sorted(items, key=lambda v: v.code)]


@router.get("/variables/quality", tags=["Variáveis"])
def variables_quality(node_id: int | None = None, period: str | None = PeriodQ, db: Session = Depends(get_db),
                      _: AppUser = Depends(get_current_user)):
    """Completude, última atualização e distribuição de qualidade por variável no período."""
    a = resolve_period(db, period)
    lk = Lookup(db)
    items = list(lk.variables.values())
    if node_id:
        node = get_or_404(db, HierarchyNode, node_id, "Nó")
        ids = {n.id for n in lk.nodes.values() if n.path.startswith(node.path)}
        items = [v for v in items if v.node_id in ids]
    repo = SeriesRepository(db)
    ids = [v.id for v in items]
    aggs = repo.period_aggregates(ids, a.eff_start, a.eff_end)
    quality = repo.quality_breakdown(ids, a.eff_start, a.eff_end)
    last = repo.last_update(ids)
    out = []
    for v in items:
        agg = aggs.get(v.id)
        q = quality.get(v.id, {})
        total = sum(q.values()) or 0
        completeness = min(100.0, (agg.days if agg else 0) / a.days * 100) if a.days else 0.0
        bad = q.get("bad", 0) + q.get("suspect", 0)
        out.append({
            **lk.variable(v),
            "period": a.to_dict(),
            "days_with_data": agg.days if agg else 0,
            "expected_days": a.days,
            "completeness_pct": round(completeness, 1),
            "quality_breakdown": q,
            "suspect_or_bad_pct": round(bad / total * 100, 2) if total else 0.0,
            "last_value_at": last.get(v.id).isoformat() if last.get(v.id) else None,
            "quality_status": ("sem_dados" if completeness < 60 else
                               "atencao" if completeness < 90 or (total and bad / total > 0.02) else "normal"),
        })
    return {"period": a.to_dict(), "items": sorted(out, key=lambda x: x["completeness_pct"])}


@router.get("/variables/{variable_id}", tags=["Variáveis"])
def get_variable(variable_id: int, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    v = get_or_404(db, Variable, variable_id, "Variável")
    return Lookup(db).variable(v)


@router.get("/variables/{variable_id}/series", tags=["Variáveis"])
def variable_series(variable_id: int, period: str | None = PeriodQ, grain: str | None = None,
                    start: date | None = None, end: date | None = None, db: Session = Depends(get_db),
                    _: AppUser = Depends(get_current_user)):
    v = get_or_404(db, Variable, variable_id, "Variável")
    if start is None or end is None:
        a = resolve_period(db, period)
        start, end = a.eff_start, a.eff_end
    grain = grain or auto_grain(start, end)
    daily = SeriesRepository(db).daily([v.id], start, end).get(v.id, {})
    points = []
    for b0, b1 in iter_buckets(start, end, grain):
        stats = [s for d, s in daily.items() if b0 <= d <= b1]
        if not stats:
            points.append({"start": b0.isoformat(), "label": bucket_label(b0, grain), "value": None, "days": 0})
            continue
        if v.aggregation == "avg":
            n = sum(s.n for s in stats)
            value = sum(s.sum for s in stats) / n if n else None
        elif v.aggregation == "min":
            value = min(s.min for s in stats)
        elif v.aggregation == "max":
            value = max(s.max for s in stats)
        else:
            value = sum(s.sum for s in stats)
        points.append({"start": b0.isoformat(), "end": b1.isoformat(), "label": bucket_label(b0, grain),
                       "value": value, "days": len(stats)})
    lk = Lookup(db)
    return {"variable": lk.variable(v), "grain": grain, "start": start.isoformat(), "end": end.isoformat(),
            "points": points}


@router.post("/variables", tags=["Variáveis"], status_code=201)
def create_variable(body: VariableIn, request: Request, db: Session = Depends(get_db),
                    user: AppUser = Depends(get_current_user)):
    ensure_can_edit_node(db, user, body.node_id)
    if db.scalar(select(Variable).where(Variable.code == body.code)):
        raise HTTPException(409, f"Já existe variável com o código '{body.code}'.")
    obj = Variable(**body.model_dump())
    db.add(obj)
    db.flush()
    audit(db, user, "create", "variable", obj.id, after=row_to_dict(obj), request=request)
    db.commit()
    cache.invalidate()
    return Lookup(db).variable(obj)


@router.put("/variables/{variable_id}", tags=["Variáveis"])
def update_variable(variable_id: int, body: VariableIn, request: Request, db: Session = Depends(get_db),
                    user: AppUser = Depends(get_current_user)):
    obj = get_or_404(db, Variable, variable_id, "Variável")
    ensure_can_edit_node(db, user, obj.node_id)
    before = row_to_dict(obj)
    for k, v in body.model_dump().items():
        setattr(obj, k, v)
    db.flush()
    audit(db, user, "update", "variable", obj.id, before, row_to_dict(obj), request)
    db.commit()
    cache.invalidate()
    return Lookup(db).variable(obj)
