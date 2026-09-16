"""Montagem de análises reutilizadas por rotas: avaliação em lote, contagem de status e diagnóstico."""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.lookup import Lookup
from app.engine.indicators import IndicatorEngine, change
from app.engine.periods import ResolvedPeriod
from app.engine.status import STATUS_LABELS, STATUS_SEVERITY
from app.models import HierarchyNode, Indicator, Opportunity


def indicators_in_subtree(db: Session, node: HierarchyNode) -> list[Indicator]:
    ids = list(db.scalars(select(HierarchyNode.id).where(HierarchyNode.path.startswith(node.path))))
    inds = IndicatorEngine.load_indicators(db)
    return [i for i in inds if i.node_id in ids]


def evaluation_rows(
    db: Session,
    lookup: Lookup,
    indicators: list[Indicator],
    a: ResolvedPeriod,
    b: ResolvedPeriod | None,
    spark: bool = False,
    engine: IndicatorEngine | None = None,
    components: bool = False,
) -> list[dict]:
    engine = engine or IndicatorEngine(db)
    ea = engine.evaluate(indicators, a)
    eb = engine.evaluate(indicators, b) if b is not None else {}
    opp_counts = dict(
        db.execute(
            select(Opportunity.indicator_id, func.count())
            .where(Opportunity.status.notin_(("cancelada", "verificada")))
            .group_by(Opportunity.indicator_id)
        ).all()
    )
    rows = []
    for ind in indicators:
        cur = ea[ind.id]
        prev = eb.get(ind.id)
        row = {
            **lookup.indicator(ind),
            "current": _slim(cur.to_dict(), components),
            "previous": _slim(prev.to_dict(), components) if prev else None,
            "open_opportunities": opp_counts.get(ind.id, 0),
        }
        row.update(change(ind, cur.value, prev.value if prev else None))
        if spark:
            end = a.eff_end
            start = end - timedelta(weeks=12) + timedelta(days=1)
            start = start - timedelta(days=start.weekday())
            pts = engine.series(ind, start, end, "week")
            row["spark"] = [p["value"] for p in pts]
        rows.append(row)
    return rows


def _slim(ev: dict, components: bool) -> dict:
    """Remove detalhes pesados das listas; o detalhe completo vem no endpoint do indicador."""
    comps = ev.pop("components", [])
    if components:
        ev["components"] = [
            {k: c[k] for k in ("symbol", "source_type", "value", "unit", "aggregation", "variable_id",
                               "variable_code", "variable_name", "variable_type", "completeness_pct")}
            for c in comps
        ]
    return ev


def status_counts(rows: list[dict]) -> dict:
    c = Counter(r["current"]["status"] for r in rows)
    return {k: c.get(k, 0) for k in STATUS_LABELS}


def worst_status(statuses) -> str | None:
    statuses = [s for s in statuses if s]
    if not statuses:
        return None
    return max(statuses, key=lambda s: STATUS_SEVERITY.get(s, 0))


def diagnostics(db: Session, lookup: Lookup, node: HierarchyNode, a: ResolvedPeriod, b: ResolvedPeriod,
                rows: list[dict] | None = None, energy_cmp: dict | None = None, unallocated: list | None = None) -> list[dict]:
    """Principais achados do período: desvios, deteriorações, qualidade de dado e contexto de produção."""
    engine = IndicatorEngine(db)
    if rows is None:
        rows = evaluation_rows(db, lookup, indicators_in_subtree(db, node), a, b, engine=engine)
    items: list[dict] = []

    for r in rows:
        cur = r["current"]
        ref = {"indicator_id": r["id"], "indicator": r["name"], "code": r["code"], "unit": r["unit"],
               "node": r["node"], "use": r["use"], "equipment": r["equipment"], "value": cur["value"],
               "target": cur["target"], "target_min": cur["target_min"], "target_max": cur["target_max"],
               "baseline": cur["baseline"], "deviation_pct": cur["deviation_pct"], "delta_pct": r["delta_pct"],
               "status": cur["status"], "open_opportunities": r["open_opportunities"], "decimals": r["decimals"]}
        if cur["status"] in ("critico", "atencao"):
            items.append({**ref, "type": "desvio", "severity": cur["status"],
                          "title": f"{r['name']}: {STATUS_LABELS[cur['status']].lower()}",
                          "explanation": cur["status_explanation"]})
        elif r["change_class"] == "piora" and r["delta_pct"] is not None and cur["status"] not in ("sem_dados",) \
                and abs(r["delta_pct"]) >= max(8.0, 2 * (r.get("stability_band_pct") or 3.0)):
            items.append({**ref, "type": "deterioracao", "severity": "atencao",
                          "title": f"{r['name']}: piora de {abs(r['delta_pct']):.1f}% vs período anterior",
                          "explanation": "Ainda dentro da meta, mas com deterioração relevante frente ao período de comparação."})
        if cur["status"] == "sem_dados":
            items.append({**ref, "type": "qualidade_dados", "severity": "sem_dados",
                          "title": f"{r['name']}: dados insuficientes ({cur['completeness_pct']:.0f}% de completude)",
                          "explanation": cur["status_explanation"]})

    # mudança de comportamento (regra de sequência) para os indicadores com desvio
    flagged = [i for i in items if i["type"] == "desvio"][:12]
    ind_by_id = {i.id: i for i in IndicatorEngine.load_indicators(db, [f["indicator_id"] for f in flagged])} if flagged else {}
    for f in flagged:
        ind = ind_by_id.get(f["indicator_id"])
        if not ind:
            continue
        start = a.eff_end - timedelta(weeks=26)
        h = engine.history(ind, start - timedelta(days=start.weekday()), a.eff_end, "week")
        shift = h["control"]["shift_detected_at"]
        if shift:
            f["behavior_change_since"] = shift
        f["trend"] = h["trend"]["classification"]

    if energy_cmp and energy_cmp.get("decomposition"):
        d = energy_cmp["decomposition"]
        e_pct = energy_cmp.get("energy_delta_pct")
        i_pct = energy_cmp.get("intensity_delta_pct")
        if e_pct is not None and i_pct is not None:
            if e_pct > 3 and i_pct <= 0:
                text = (f"Consumo {e_pct:+.1f}% explicado pelo volume: efeito produção {d['production_effect']:+.1f} MWh; "
                        f"intensidade {i_pct:+.1f}% (efeito {d['intensity_effect']:+.1f} MWh).")
                items.append({"type": "contexto", "severity": "normal", "title": "Aumento de consumo não indica piora",
                              "explanation": text, "node": lookup.node_brief(node.id)})
            elif e_pct < -3 and i_pct > 3:
                text = (f"Consumo caiu {e_pct:.1f}%, mas a intensidade piorou {i_pct:+.1f}%: a queda veio do menor volume "
                        f"(efeito produção {d['production_effect']:+.1f} MWh).")
                items.append({"type": "contexto", "severity": "atencao", "title": "Redução de consumo mascara piora de eficiência",
                              "explanation": text, "node": lookup.node_brief(node.id)})
    for u in unallocated or []:
        if u.get("inconsistent"):
            items.append({"type": "qualidade_dados", "severity": "sem_dados", "node": lookup.node_brief(node.id),
                          "title": "Submedições excedem o medidor geral",
                          "explanation": f"{u['name']}: alocado {u['allocated_mwh']:.1f} MWh > medido {u['measured_mwh']:.1f} MWh."})

    order = {"desvio": 0, "deterioracao": 1, "contexto": 2, "qualidade_dados": 3}
    items.sort(key=lambda i: (order.get(i["type"], 9), -STATUS_SEVERITY.get(i.get("severity"), 0),
                              -abs(i.get("deviation_pct") or i.get("delta_pct") or 0)))
    return items


def window_start(end: date, grain: str, buckets: int) -> date:
    if grain == "week":
        monday = end - timedelta(days=end.weekday())
        return monday - timedelta(weeks=buckets - 1)
    if grain == "month":
        y, m = end.year, end.month - buckets + 1
        while m <= 0:
            y, m = y - 1, m + 12
        return date(y, m, 1)
    return end - timedelta(days=buckets - 1)
