"""Hierarquia configurável, fluxogramas e consolidação de energia por nó."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import CompareQ, PeriodQ, get_or_404, resolve_period, resolve_periods, row_to_dict
from app.api.lookup import Lookup
from app.api.schemas import FlowIn, NodeIn
from app.db import get_db
from app.engine.periods import auto_grain
from app.engine.repository import cache
from app.models import AppUser, FlowEdge, FlowNode, HierarchyNode, OperationalEvent, SignificantEnergyUse, Variable
from app.security import EDITORS, audit, ensure_can_edit_node, get_current_user, require_roles
from app.services import hierarchy as hsvc
from app.services.analysis import diagnostics, evaluation_rows, indicators_in_subtree, status_counts, window_start
from app.services.energy import EnergyService

router = APIRouter(tags=["Hierarquia"])


@router.get("/hierarchy/tree")
def get_tree(db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    return hsvc.tree(db)


@router.get("/nodes")
def list_nodes(level: str | None = None, parent_id: int | None = None, db: Session = Depends(get_db),
               _: AppUser = Depends(get_current_user)):
    q = select(HierarchyNode).order_by(HierarchyNode.path)
    if level:
        q = q.where(HierarchyNode.level == level)
    if parent_id:
        q = q.where(HierarchyNode.parent_id == parent_id)
    lk = Lookup(db)
    return [{**row_to_dict(n), "path_nodes": lk.path(n.id)} for n in db.scalars(q)]


@router.get("/nodes/{node_id}")
def get_node(node_id: int, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    lk = Lookup(db)
    children = [n for n in lk.nodes.values() if n.parent_id == node.id]
    sub_ids = set(hsvc.subtree_ids(db, node))
    uses = [u for u in lk.uses.values() if u.node_id in sub_ids]
    prod = EnergyService(db).production_var(node)
    return {
        **row_to_dict(node),
        "path_nodes": lk.path(node.id),
        "owner": lk.person(node.owner_id),
        "children": [{**row_to_dict(c), "uses": len([u for u in lk.uses.values() if u.node_id == c.id])}
                     for c in sorted(children, key=lambda c: c.sort_order)],
        "uses": [lk.use(u) for u in sorted(uses, key=lambda u: u.code)],
        "production_variable": lk.variable(prod) if prod else None,
        "has_flow": db.scalar(select(FlowNode.id).where(FlowNode.diagram_node_id == node.id).limit(1)) is not None,
    }


@router.post("/nodes", status_code=201)
def create_node(body: NodeIn, request: Request, db: Session = Depends(get_db),
                user: AppUser = Depends(require_roles(*EDITORS))):
    if db.scalar(select(HierarchyNode).where(HierarchyNode.code == body.code)):
        raise HTTPException(409, f"Já existe um nó com o código '{body.code}'.")
    node = HierarchyNode(**body.model_dump())
    db.add(node)
    db.flush()
    hsvc.recompute_path(db, node)
    audit(db, user, "create", "hierarchy_node", node.id, after=row_to_dict(node), request=request)
    db.commit()
    cache.invalidate()
    return row_to_dict(node)


@router.put("/nodes/{node_id}")
def update_node(node_id: int, body: NodeIn, request: Request, db: Session = Depends(get_db),
                user: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    ensure_can_edit_node(db, user, node_id)
    before = row_to_dict(node)
    for k, v in body.model_dump().items():
        setattr(node, k, v)
    db.flush()
    hsvc.recompute_path(db, node)
    audit(db, user, "update", "hierarchy_node", node.id, before, row_to_dict(node), request)
    db.commit()
    cache.invalidate()
    return row_to_dict(node)


@router.delete("/nodes/{node_id}", status_code=204)
def delete_node(node_id: int, request: Request, db: Session = Depends(get_db),
                user: AppUser = Depends(require_roles(*EDITORS))):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    if len(hsvc.subtree_ids(db, node)) > 1:
        raise HTTPException(409, "Remova primeiro os nós filhos.")
    if db.scalar(select(SignificantEnergyUse.id).where(SignificantEnergyUse.node_id == node.id).limit(1)):
        raise HTTPException(409, "Existem USEs vinculados a este nó.")
    audit(db, user, "delete", "hierarchy_node", node.id, row_to_dict(node), None, request)
    db.delete(node)
    db.commit()
    cache.invalidate()


# ---------------------------------------------------------------------- fluxograma
@router.get("/nodes/{node_id}/flow")
def get_flow(node_id: int, period: str | None = PeriodQ, compare: str | None = CompareQ,
             metrics: bool = True, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    lk = Lookup(db)
    fnodes = list(db.scalars(select(FlowNode).where(FlowNode.diagram_node_id == node.id).order_by(FlowNode.sort_order)))
    fedges = list(db.scalars(select(FlowEdge).where(FlowEdge.diagram_node_id == node.id)))
    if not fnodes:  # fluxo automático: filhos em sequência (nó recém-criado ainda sem diagrama)
        kids = sorted([n for n in lk.nodes.values() if n.parent_id == node.id], key=lambda n: n.sort_order)
        return {
            "node": lk.node_brief(node.id),
            "auto_generated": True,
            "nodes": [{"id": -(i + 1), "kind": "process", "label": k.name, "hierarchy_node_id": k.id,
                       "linked_node_id": None, "pos_x": 300.0 * i, "pos_y": 0.0, "metrics": None} for i, k in enumerate(kids)],
            "edges": [{"id": -(i + 1), "source": -(i + 1), "target": -(i + 2), "stream_type": "material",
                       "label": None, "carrier": None} for i in range(len(kids) - 1)],
        }
    out_nodes = []
    metrics_by_node: dict[int, dict] = {}
    if metrics:
        a, b = resolve_periods(db, period, compare)
        energy = EnergyService(db)
        engine_rows_cache: dict[int, list[dict]] = {}
        for fn in fnodes:
            if not fn.hierarchy_node_id:
                continue
            hn = lk.nodes.get(fn.hierarchy_node_id)
            if hn is None:
                continue
            cmp_ = energy.summary_compare(hn, a, b)
            rows = engine_rows_cache.setdefault(
                hn.id, evaluation_rows(db, lk, indicators_in_subtree(db, hn), a, None)
            )
            metrics_by_node[fn.id] = {
                "energy": cmp_["current"], "previous": cmp_["previous"],
                "energy_delta_pct": cmp_["energy_delta_pct"], "production_delta_pct": cmp_["production_delta_pct"],
                "intensity_delta_pct": cmp_["intensity_delta_pct"], "status_counts": status_counts(rows),
                "indicators": len(rows),
                "uses": len([u for u in lk.uses.values() if u.node_id in set(hsvc.subtree_ids(db, hn))]),
            }
    for fn in fnodes:
        out_nodes.append({
            "id": fn.id, "kind": fn.kind, "label": fn.label, "hierarchy_node_id": fn.hierarchy_node_id,
            "linked_node_id": fn.linked_node_id, "pos_x": fn.pos_x, "pos_y": fn.pos_y,
            "node": lk.node_brief(fn.hierarchy_node_id), "linked_node": lk.node_brief(fn.linked_node_id),
            "metrics": metrics_by_node.get(fn.id),
        })
    return {
        "node": lk.node_brief(node.id),
        "auto_generated": False,
        "nodes": out_nodes,
        "edges": [{"id": e.id, "source": e.source_id, "target": e.target_id, "stream_type": e.stream_type,
                   "label": e.label, "carrier": lk.carrier(e.energy_carrier_id)} for e in fedges],
    }


@router.put("/nodes/{node_id}/flow")
def save_flow(node_id: int, body: FlowIn, request: Request, db: Session = Depends(get_db),
              user: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    ensure_can_edit_node(db, user, node_id)
    existing = {f.id: f for f in db.scalars(select(FlowNode).where(FlowNode.diagram_node_id == node.id))}
    db.execute(FlowEdge.__table__.delete().where(FlowEdge.diagram_node_id == node.id))
    keep: set[int] = set()
    ref: dict[str, FlowNode] = {}
    for i, n in enumerate(body.nodes):
        obj = existing.get(n.id) if n.id and n.id > 0 else None
        if obj is None:
            obj = FlowNode(diagram_node_id=node.id)
            db.add(obj)
        obj.kind, obj.label = n.kind, n.label
        obj.hierarchy_node_id, obj.linked_node_id = n.hierarchy_node_id, n.linked_node_id
        obj.pos_x, obj.pos_y, obj.sort_order = n.pos_x, n.pos_y, i
        db.flush()
        keep.add(obj.id)
        ref[str(n.id) if n.id else (n.key or "")] = obj
        if n.key:
            ref[n.key] = obj
    for old_id, obj in existing.items():
        if old_id not in keep:
            db.delete(obj)
    for e in body.edges:
        src, dst = ref.get(e.source), ref.get(e.target)
        if not src or not dst:
            raise HTTPException(422, f"Aresta com nó inexistente: {e.source} → {e.target}")
        db.add(FlowEdge(diagram_node_id=node.id, source_id=src.id, target_id=dst.id, stream_type=e.stream_type,
                        label=e.label, energy_carrier_id=e.energy_carrier_id))
    audit(db, user, "update", "flow", node.id, after={"nodes": len(body.nodes), "edges": len(body.edges)},
          request=request)
    db.commit()
    return get_flow(node_id, None, None, False, db, user)


# ---------------------------------------------------------------------- energia e indicadores do nó
@router.get("/nodes/{node_id}/summary")
def node_summary(node_id: int, period: str | None = PeriodQ, compare: str | None = CompareQ,
                 db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    a, b = resolve_periods(db, period, compare)
    lk = Lookup(db)
    energy = EnergyService(db)
    rows = evaluation_rows(db, lk, indicators_in_subtree(db, node), a, b)
    return {
        "node": {**row_to_dict(node), "path_nodes": lk.path(node.id), "owner": lk.person(node.owner_id)},
        "period": a.to_dict(), "comparison_period": b.to_dict(),
        "energy": energy.summary_compare(node, a, b),
        "status_counts": status_counts(rows),
        "indicator_count": len(rows),
    }


@router.get("/nodes/{node_id}/indicators")
def node_indicators(node_id: int, period: str | None = PeriodQ, compare: str | None = CompareQ,
                    spark: bool = False, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    a, b = resolve_periods(db, period, compare)
    lk = Lookup(db)
    rows = evaluation_rows(db, lk, indicators_in_subtree(db, node), a, b, spark=spark)
    return {"period": a.to_dict(), "comparison_period": b.to_dict(), "items": rows,
            "status_counts": status_counts(rows)}


@router.get("/nodes/{node_id}/energy/children")
def node_children_energy(node_id: int, period: str | None = PeriodQ, compare: str | None = CompareQ,
                         db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    a, b = resolve_periods(db, period, compare)
    energy = EnergyService(db)
    lk = Lookup(db)
    out = []
    for child in sorted([n for n in energy.nodes.values() if n.parent_id == node.id], key=lambda n: n.sort_order):
        cmp_ = energy.summary_compare(child, a, b)
        rows = evaluation_rows(db, lk, indicators_in_subtree(db, child), a, None)
        out.append({"node": lk.node_brief(child.id), **cmp_, "status_counts": status_counts(rows),
                    "indicator_count": len(rows)})
    return {"period": a.to_dict(), "comparison_period": b.to_dict(), "items": out}


@router.get("/nodes/{node_id}/energy/uses")
def node_uses_energy(node_id: int, period: str | None = PeriodQ, compare: str | None = CompareQ,
                     db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    a, b = resolve_periods(db, period, compare)
    energy = EnergyService(db)
    lk = Lookup(db)
    cur = energy.by_use(node, a)
    prev = {u["use_id"]: u["mwh"] for u in energy.by_use(node, b)["uses"]}
    inds = indicators_in_subtree(db, node)
    rows = evaluation_rows(db, lk, inds, a, None)
    by_use: dict[int, list] = {}
    for r in rows:
        if r["use"]:
            by_use.setdefault(r["use"]["id"], []).append(r["current"]["status"])
    from app.services.analysis import worst_status

    for u in cur["uses"]:
        u["previous_mwh"] = prev.get(u["use_id"])
        u["delta_pct"] = ((u["mwh"] - prev[u["use_id"]]) / prev[u["use_id"]] * 100
                          if prev.get(u["use_id"]) else None)
        u["worst_status"] = worst_status(by_use.get(u["use_id"], []))
        u["indicator_count"] = len(by_use.get(u["use_id"], []))
    return {"period": a.to_dict(), **cur}


@router.get("/nodes/{node_id}/energy/series")
def node_energy_series(node_id: int, period: str | None = PeriodQ, group: str = Query("child", pattern="^(child|carrier)$"),
                       grain: str | None = None, window: int | None = None, db: Session = Depends(get_db),
                       _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    a = resolve_period(db, period)
    if window:
        grain = grain or ("month" if window > 8 else "week")
        start = window_start(a.eff_end, grain, window)
        end = a.eff_end
    else:
        start, end = a.eff_start, a.eff_end
        grain = grain or auto_grain(start, end)
    return EnergyService(db).series(node, start, end, grain, group)


@router.get("/nodes/{node_id}/sankey")
def node_sankey(node_id: int, period: str | None = PeriodQ, db: Session = Depends(get_db),
                _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    a = resolve_period(db, period)
    return {"period": a.to_dict(), **EnergyService(db).sankey(node, a)}


@router.get("/nodes/{node_id}/diagnostics")
def node_diagnostics(node_id: int, period: str | None = PeriodQ, compare: str | None = CompareQ,
                     db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    a, b = resolve_periods(db, period, compare)
    lk = Lookup(db)
    energy = EnergyService(db)
    rows = evaluation_rows(db, lk, indicators_in_subtree(db, node), a, b)
    cmp_ = energy.summary_compare(node, a, b)
    unalloc = energy.by_use(node, a)["unallocated"]
    return {"period": a.to_dict(), "comparison_period": b.to_dict(),
            "items": diagnostics(db, lk, node, a, b, rows, cmp_, unalloc)}


@router.get("/nodes/{node_id}/events")
def node_events(node_id: int, start: date | None = None, end: date | None = None, db: Session = Depends(get_db),
                _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    ids = hsvc.subtree_ids(db, node)
    q = select(OperationalEvent).where(OperationalEvent.node_id.in_(ids)).order_by(OperationalEvent.ts_start.desc())
    if start:
        q = q.where(OperationalEvent.ts_start >= start)
    if end:
        q = q.where(OperationalEvent.ts_start <= end + timedelta(days=1))
    lk = Lookup(db)
    return [{**row_to_dict(e), "equipment": lk.equipment_item(lk.equipment[e.equipment_id])["tag"]
             if e.equipment_id in lk.equipment else None} for e in db.scalars(q.limit(200))]


@router.get("/nodes/{node_id}/variables")
def node_variables(node_id: int, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó")
    ids = hsvc.subtree_ids(db, node)
    lk = Lookup(db)
    return [lk.variable(v) for v in db.scalars(select(Variable).where(Variable.node_id.in_(ids)).order_by(Variable.code))]
