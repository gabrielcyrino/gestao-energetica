"""Dashboard executivo, comparação entre períodos, matrizes e radar de tendências."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import CompareQ, PeriodQ, get_or_404, resolve_period, resolve_periods
from app.api.lookup import Lookup
from app.db import get_db
from app.engine.indicators import IndicatorEngine
from app.engine.repository import SeriesRepository
from app.engine.stats import pct_change
from app.models import AppUser, Equipment, HierarchyNode, Opportunity, SignificantEnergyUse, UseCategory
from app.security import get_current_user
from app.services.analysis import (
    diagnostics,
    evaluation_rows,
    indicators_in_subtree,
    status_counts,
    window_start,
    worst_status,
)
from app.services.energy import EnergyService

router = APIRouter()


def _plant(db: Session) -> HierarchyNode:
    node = db.scalar(select(HierarchyNode).where(HierarchyNode.level == "plant").order_by(HierarchyNode.id))
    if node is None:
        raise HTTPException(404, "Nenhuma planta cadastrada.")
    return node


# ---------------------------------------------------------------------- dashboard executivo
@router.get("/dashboard/overview", tags=["Dashboard"])
def overview(period: str | None = PeriodQ, compare: str | None = CompareQ, node_id: int | None = None,
             db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    node = get_or_404(db, HierarchyNode, node_id, "Nó") if node_id else _plant(db)
    a, b = resolve_periods(db, period, compare)
    lk = Lookup(db)
    energy = EnergyService(db)
    engine = IndicatorEngine(db)

    rows = evaluation_rows(db, lk, indicators_in_subtree(db, node), a, b, engine=engine)
    plant_cmp = energy.summary_compare(node, a, b)

    areas = []
    for child in sorted([n for n in energy.nodes.values() if n.parent_id == node.id], key=lambda n: n.sort_order):
        child_rows = [r for r in rows if r["node"] and lk.nodes[r["node"]["id"]].path.startswith(child.path)]
        areas.append({"node": lk.node_brief(child.id), **energy.summary_compare(child, a, b),
                      "status_counts": status_counts(child_rows), "indicator_count": len(child_rows)})

    processes = []
    for p in sorted([n for n in energy.nodes.values() if n.level == "process" and n.path.startswith(node.path)],
                    key=lambda n: (n.parent_id or 0, n.sort_order)):
        p_rows = [r for r in rows if r["node"] and lk.nodes[r["node"]["id"]].path.startswith(p.path)]
        cmp_ = energy.summary_compare(p, a, b)
        processes.append({"node": lk.node_brief(p.id), "area": lk.area_of(p.id), **cmp_,
                          "status_counts": status_counts(p_rows), "indicator_count": len(p_rows),
                          "worst_status": worst_status([r["current"]["status"] for r in p_rows])})

    uses_now = energy.by_use(node, a)
    uses_prev = {u["use_id"]: u["mwh"] for u in energy.by_use(node, b)["uses"]}
    for u in uses_now["uses"]:
        u["previous_mwh"] = uses_prev.get(u["use_id"])
        u["delta_pct"] = pct_change(u["mwh"], uses_prev.get(u["use_id"]))

    evaluated = [r for r in rows if r["current"]["value"] is not None]
    off_target = sorted(
        [r for r in evaluated if r["current"]["status"] in ("critico", "atencao")],
        key=lambda r: -(r["current"]["deviation_pct"] or 0),
    )
    movers = [r for r in evaluated if r["delta_pct"] is not None and r["direction"] != "none"
              and r["current"]["status"] != "sem_dados"]
    worsening = sorted([r for r in movers if r["change_class"] == "piora"],
                       key=lambda r: -abs(r["delta_pct"]))
    improving = sorted([r for r in movers if r["change_class"] == "melhoria"],
                       key=lambda r: -abs(r["delta_pct"]))

    series = energy.series(node, window_start(a.eff_end, "month", 13), a.eff_end, "month", "child")
    carrier_series = energy.series(node, window_start(a.eff_end, "month", 13), a.eff_end, "month", "carrier")

    # heatmap: intensidade por processo × mês, variação vs mesmo mês do ano anterior
    heat = []
    hstart = window_start(a.eff_end, "month", 24)
    for p in processes:
        hp = energy.series(lk.nodes[p["node"]["id"]], hstart, a.eff_end, "month", "carrier")
        labels = [bk["label"] for bk in hp["buckets"]]
        inten = hp["intensity"] or []
        cells = []
        for i in range(12, len(inten)):
            prev = inten[i - 12]
            cells.append({"label": labels[i], "start": hp["buckets"][i]["start"], "value": inten[i],
                          "yoy_pct": pct_change(inten[i], prev)})
        heat.append({"node": p["node"], "unit": hp["production_unit"], "cells": cells})

    opp = db.execute(select(Opportunity.status, Opportunity.estimated_savings_mwh_year)).all()
    open_status = ("identificada", "em_analise", "aprovada", "em_implementacao")
    return {
        "node": lk.node_brief(node.id),
        "period": a.to_dict(), "comparison_period": b.to_dict(),
        "energy": plant_cmp,
        "areas": areas,
        "processes": processes,
        "carriers": {"current": plant_cmp["current"]["by_carrier"], "previous": plant_cmp["previous"]["by_carrier"]},
        "uses": uses_now["uses"][:10],
        "use_categories": uses_now["categories"],
        "unallocated": uses_now["unallocated"],
        "status_counts": status_counts(rows),
        "indicator_count": len(rows),
        "off_target": off_target[:12],
        "worsening": worsening[:8],
        "improving": improving[:8],
        "energy_series": series,
        "carrier_series": carrier_series,
        "intensity_heatmap": heat,
        "opportunities": {
            "open": sum(1 for s, _ in opp if s in open_status),
            "total": len(opp),
            "savings_mwh_year": sum(v or 0 for s, v in opp if s in open_status),
        },
    }


# ---------------------------------------------------------------------- comparação entre períodos
@router.get("/compare", tags=["Comparações"])
def compare(period: str | None = PeriodQ, compare: str | None = CompareQ, node_id: int | None = None,
            use_id: int | None = None, equipment_id: int | None = None, grain: str | None = None,
            db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    a, b = resolve_periods(db, period, compare)
    lk = Lookup(db)
    energy = EnergyService(db)
    scope: dict
    if equipment_id:
        eq = get_or_404(db, Equipment, equipment_id, "Equipamento")
        inds = [i for i in IndicatorEngine.load_indicators(db) if i.equipment_id == eq.id]
        node = lk.nodes[lk.uses[eq.use_id].node_id]
        scope = {"type": "equipment", "id": eq.id, "name": eq.name, "node": lk.node_brief(node.id)}
    elif use_id:
        use = get_or_404(db, SignificantEnergyUse, use_id, "USE")
        inds = [i for i in IndicatorEngine.load_indicators(db) if i.use_id == use.id]
        node = lk.nodes[use.node_id]
        scope = {"type": "use", "id": use.id, "name": use.name, "node": lk.node_brief(node.id)}
    else:
        node = get_or_404(db, HierarchyNode, node_id, "Nó") if node_id else _plant(db)
        inds = indicators_in_subtree(db, node)
        scope = {"type": "node", "id": node.id, "name": node.name, "node": lk.node_brief(node.id)}

    rows = evaluation_rows(db, lk, inds, a, b)
    energy_cmp = energy.summary_compare(node, a, b)
    children = []
    for child in sorted([n for n in energy.nodes.values() if n.parent_id == node.id], key=lambda n: n.sort_order):
        children.append({"node": lk.node_brief(child.id), **energy.summary_compare(child, a, b)})

    grain = grain or ("day" if a.days <= 62 else "week" if a.days <= 280 else "month")
    overlay_a = energy.series(node, a.eff_start, a.eff_end, grain, "carrier")
    overlay_b = energy.series(node, b.eff_start, b.eff_end, grain, "carrier")
    uses_a = energy.by_use(node, a)
    uses_b = {u["use_id"]: u["mwh"] for u in energy.by_use(node, b)["uses"]}
    for u in uses_a["uses"]:
        u["previous_mwh"] = uses_b.get(u["use_id"])
        u["delta_pct"] = pct_change(u["mwh"], uses_b.get(u["use_id"]))
    return {
        "scope": scope,
        "period": a.to_dict(), "comparison_period": b.to_dict(),
        "energy": energy_cmp,
        "children": children,
        "uses": uses_a["uses"],
        "indicators": rows,
        "status_counts": status_counts(rows),
        "overlay": {"grain": grain, "current": overlay_a, "previous": overlay_b},
        "diagnostics": diagnostics(db, lk, node, a, b, rows, energy_cmp, uses_a["unallocated"]),
    }


# ---------------------------------------------------------------------- matrizes
@router.get("/matrix/process-use", tags=["Matrizes"])
def matrix_process_use(period: str | None = PeriodQ, node_id: int | None = None, db: Session = Depends(get_db),
                       _: AppUser = Depends(get_current_user)):
    """Matriz Processo × categoria de USE: onde cada uso significativo está presente."""
    root = get_or_404(db, HierarchyNode, node_id, "Nó") if node_id else _plant(db)
    a = resolve_period(db, period)
    lk = Lookup(db)
    energy = EnergyService(db)
    categories = [lk.category(c.id) for c in sorted(lk.categories.values(), key=lambda c: c.sort_order)]
    inds = indicators_in_subtree(db, root)
    rows_eval = evaluation_rows(db, lk, inds, a, None)
    status_by_use: dict[int, list[str]] = {}
    for r in rows_eval:
        if r["use"]:
            status_by_use.setdefault(r["use"]["id"], []).append(r["current"]["status"])
    out_rows = []
    for p in sorted([n for n in energy.nodes.values() if n.level == "process" and n.path.startswith(root.path)],
                    key=lambda n: (n.parent_id or 0, n.sort_order)):
        breakdown = energy.by_use(p, a)
        total = breakdown["total_mwh"]
        cells = {}
        for u in breakdown["uses"]:
            cell = cells.setdefault(u["category_code"], {"uses": [], "mwh": 0.0, "equipment": 0, "statuses": []})
            cell["uses"].append({"id": u["use_id"], "name": u["name"], "code": u["code"], "node": u["node_name"],
                                 "mwh": u["mwh"], "regime": u["operating_regime"]})
            cell["mwh"] += u["mwh"]
            cell["equipment"] += u["equipment_count"]
            cell["statuses"] += status_by_use.get(u["use_id"], [])
        for c in cells.values():
            c["share_pct"] = c["mwh"] / total * 100 if total else None
            c["worst_status"] = worst_status(c["statuses"])
            c.pop("statuses")
        out_rows.append({"node": lk.node_brief(p.id), "area": lk.area_of(p.id), "total_mwh": total, "cells": cells})
    return {"period": a.to_dict(), "categories": categories, "rows": out_rows}


@router.get("/matrix/use-indicator", tags=["Matrizes"])
def matrix_use_indicator(period: str | None = PeriodQ, node_id: int | None = None, db: Session = Depends(get_db),
                         _: AppUser = Depends(get_current_user)):
    """Matriz USE × categoria de indicador (cobertura da medição de desempenho)."""
    root = get_or_404(db, HierarchyNode, node_id, "Nó") if node_id else _plant(db)
    a = resolve_period(db, period)
    lk = Lookup(db)
    inds = indicators_in_subtree(db, root)
    rows_eval = evaluation_rows(db, lk, inds, a, None)
    cats = sorted({r["category"] for r in rows_eval})
    by_use: dict[int, dict] = {}
    for r in rows_eval:
        if not r["use"]:
            continue
        item = by_use.setdefault(r["use"]["id"], {"use": r["use"], "node": r["node"], "cells": {}})
        cell = item["cells"].setdefault(r["category"], {"count": 0, "statuses": [], "indicators": []})
        cell["count"] += 1
        cell["statuses"].append(r["current"]["status"])
        cell["indicators"].append({"id": r["id"], "name": r["name"], "status": r["current"]["status"],
                                   "value": r["current"]["value"], "unit": r["unit"], "kind": r["kind"]})
    for item in by_use.values():
        for cell in item["cells"].values():
            cell["worst_status"] = worst_status(cell.pop("statuses"))
    return {"period": a.to_dict(), "categories": cats, "rows": list(by_use.values())}


@router.get("/matrix/indicators", tags=["Matrizes"])
def matrix_indicators(period: str | None = PeriodQ, compare: str | None = CompareQ, node_id: int | None = None,
                      db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    """Processo → USE → equipamento → indicador → fórmula → unidade → origem → frequência → responsável → meta."""
    root = get_or_404(db, HierarchyNode, node_id, "Nó") if node_id else _plant(db)
    a, b = resolve_periods(db, period, compare)
    lk = Lookup(db)
    inds = indicators_in_subtree(db, root)
    rows = evaluation_rows(db, lk, inds, a, b)
    for r, ind in zip(rows, inds, strict=True):
        r["bindings"] = [{"symbol": x.symbol, "source_type": x.source_type,
                          "variable": lk.variables[x.variable_id].code if x.variable_id in lk.variables else None,
                          "aggregation": x.aggregation, "constant_value": x.constant_value,
                          "attribute": x.attribute, "builtin": x.builtin} for x in ind.bindings]
    return {"period": a.to_dict(), "comparison_period": b.to_dict(), "items": rows,
            "status_counts": status_counts(rows)}


# ---------------------------------------------------------------------- tendências
@router.get("/trends", tags=["Tendências"])
def trends(period: str | None = PeriodQ, compare: str | None = CompareQ, node_id: int | None = None,
           use_id: int | None = None, grain: str = Query("week", pattern="^(day|week|month)$"),
           window: int = Query(26, ge=6, le=60), limit: int = Query(40, ge=1, le=200),
           db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    """Classificação de tendência (melhoria/deterioração/estável), outliers e mudança de comportamento."""
    node = get_or_404(db, HierarchyNode, node_id, "Nó") if node_id else _plant(db)
    a, b = resolve_periods(db, period, compare)
    lk = Lookup(db)
    engine = IndicatorEngine(db)
    inds = indicators_in_subtree(db, node)
    if use_id:
        inds = [i for i in inds if i.use_id == use_id]
    rows = evaluation_rows(db, lk, inds, a, b, engine=engine)
    by_id = {i.id: i for i in inds}
    end = a.eff_end
    start = window_start(end, grain, window)
    items = []
    for r in rows:
        ind = by_id[r["id"]]
        hist = engine.history(ind, start, end, grain)
        pts = hist["points"]
        items.append({
            **{k: r[k] for k in ("id", "code", "name", "unit", "kind", "category", "direction", "decimals",
                                 "node", "area", "process", "use", "equipment", "level")},
            "current": r["current"], "previous": r["previous"], "delta_pct": r["delta_pct"],
            "change_class": r["change_class"],
            "trend": hist["trend"], "control": hist["control"],
            "series": [{"label": p["label"], "start": p["start"], "value": p["value"], "target": p["target"],
                        "out_of_control": p["out_of_control"], "moving_avg": p["moving_avg"]} for p in pts],
        })
    severity = {"deterioracao": 0, "estavel": 2, "melhoria": 3, "insuficiente": 4, "aumento": 1, "reducao": 2}
    items.sort(key=lambda i: (severity.get(i["trend"]["classification"], 5),
                              -abs(i["trend"].get("relative_change_pct") or 0)))
    return {"period": a.to_dict(), "comparison_period": b.to_dict(), "grain": grain, "window": window,
            "start": start.isoformat(), "end": end.isoformat(), "items": items[:limit],
            "counts": {k: sum(1 for i in items if i["trend"]["classification"] == k)
                       for k in ("melhoria", "deterioracao", "estavel", "insuficiente", "aumento", "reducao")}}
