"""Serialização com cache de master data por requisição (evita N+1 em listas e matrizes)."""
from __future__ import annotations

from functools import cached_property

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    DataSource,
    EnergyBaseline,
    EnergyCarrier,
    Equipment,
    HierarchyNode,
    Indicator,
    IndicatorTemplate,
    Person,
    SignificantEnergyUse,
    Unit,
    UseCategory,
    UseRelevantVariable,
    Variable,
)


class Lookup:
    def __init__(self, db: Session):
        self.db = db

    @cached_property
    def nodes(self) -> dict[int, HierarchyNode]:
        return {n.id: n for n in self.db.scalars(select(HierarchyNode))}

    @cached_property
    def uses(self) -> dict[int, SignificantEnergyUse]:
        return {u.id: u for u in self.db.scalars(select(SignificantEnergyUse))}

    @cached_property
    def equipment(self) -> dict[int, Equipment]:
        return {e.id: e for e in self.db.scalars(select(Equipment))}

    @cached_property
    def units(self) -> dict[int, Unit]:
        return {u.id: u for u in self.db.scalars(select(Unit))}

    @cached_property
    def people(self) -> dict[int, Person]:
        return {p.id: p for p in self.db.scalars(select(Person))}

    @cached_property
    def carriers(self) -> dict[int, EnergyCarrier]:
        return {c.id: c for c in self.db.scalars(select(EnergyCarrier))}

    @cached_property
    def categories(self) -> dict[int, UseCategory]:
        return {c.id: c for c in self.db.scalars(select(UseCategory))}

    @cached_property
    def sources(self) -> dict[int, DataSource]:
        return {s.id: s for s in self.db.scalars(select(DataSource))}

    @cached_property
    def variables(self) -> dict[int, Variable]:
        return {v.id: v for v in self.db.scalars(select(Variable))}

    @cached_property
    def templates(self) -> dict[int, IndicatorTemplate]:
        return {t.id: t for t in self.db.scalars(select(IndicatorTemplate))}

    @cached_property
    def baselines(self) -> dict[int, EnergyBaseline]:
        return {b.id: b for b in self.db.scalars(select(EnergyBaseline))}

    # ------------------------------------------------------------------ helpers
    def node_brief(self, node_id: int | None) -> dict | None:
        n = self.nodes.get(node_id) if node_id else None
        if n is None:
            return None
        return {"id": n.id, "code": n.code, "name": n.name, "level": n.level, "parent_id": n.parent_id,
                "color_slot": n.color_slot}

    def path(self, node_id: int | None) -> list[dict]:
        n = self.nodes.get(node_id) if node_id else None
        if n is None:
            return []
        ids = [int(x) for x in n.path.strip("/").split("/") if x]
        return [self.node_brief(i) for i in ids if i in self.nodes]

    def area_of(self, node_id: int | None) -> dict | None:
        for item in self.path(node_id):
            if item["level"] == "area":
                return item
        return None

    def process_of(self, node_id: int | None) -> dict | None:
        for item in self.path(node_id):
            if item["level"] == "process":
                return item
        return None

    def person(self, pid: int | None) -> dict | None:
        p = self.people.get(pid) if pid else None
        return {"id": p.id, "name": p.name, "role_title": p.role_title, "email": p.email} if p else None

    def unit(self, uid: int | None) -> str | None:
        return self.units[uid].symbol if uid in self.units else None

    def carrier(self, cid: int | None) -> dict | None:
        c = self.carriers.get(cid) if cid else None
        return {"id": c.id, "code": c.code, "name": c.name, "kind": c.kind, "color_slot": c.color_slot,
                "unit": self.unit(c.unit_id)} if c else None

    def category(self, cid: int | None) -> dict | None:
        c = self.categories.get(cid) if cid else None
        return {"id": c.id, "code": c.code, "name": c.name, "icon": c.icon, "color_slot": c.color_slot} if c else None

    # ------------------------------------------------------------------ entidades
    def use(self, u: SignificantEnergyUse, detail: bool = False) -> dict:
        eqs = [e for e in self.equipment.values() if e.use_id == u.id]
        out = {
            "id": u.id, "code": u.code, "name": u.name, "description": u.description,
            "category": self.category(u.category_id), "node": self.node_brief(u.node_id),
            "area": self.area_of(u.node_id), "process": self.process_of(u.node_id),
            "carrier": self.carrier(u.energy_carrier_id), "operating_regime": u.operating_regime,
            "operating_period": u.operating_period, "significance_reason": u.significance_reason,
            "responsible": self.person(u.responsible_id), "active": u.active,
            "installed_power_kw": sum(e.rated_power_kw or 0 for e in eqs) or None,
            "equipment_count": len(eqs),
        }
        if detail:
            out["path"] = self.path(u.node_id)
            out["equipment"] = [self.equipment_item(e) for e in sorted(eqs, key=lambda e: e.tag)]
            rel = self.db.scalars(select(UseRelevantVariable).where(UseRelevantVariable.use_id == u.id))
            out["relevant_variables"] = [
                {**self.variable(self.variables[r.variable_id]), "rationale": r.rationale} for r in rel
            ]
        return out

    def equipment_item(self, e: Equipment, detail: bool = False) -> dict:
        u = self.uses.get(e.use_id)
        out = {
            "id": e.id, "tag": e.tag, "name": e.name, "equipment_type": e.equipment_type,
            "manufacturer": e.manufacturer, "model": e.model, "rated_power_kw": e.rated_power_kw,
            "rated_efficiency_pct": e.rated_efficiency_pct, "efficiency_class": e.efficiency_class,
            "has_vfd": e.has_vfd, "commissioning_year": e.commissioning_year, "attributes": e.attributes or {},
            "active": e.active,
            "use": {"id": u.id, "code": u.code, "name": u.name, "category": self.category(u.category_id)} if u else None,
            "node": self.node_brief(u.node_id) if u else None,
        }
        if detail and u:
            out["path"] = self.path(u.node_id)
            out["area"] = self.area_of(u.node_id)
            out["process"] = self.process_of(u.node_id)
            out["variables"] = [self.variable(v) for v in self.variables.values() if v.equipment_id == e.id]
        return out

    def variable(self, v: Variable) -> dict:
        src = self.sources.get(v.data_source_id)
        eq = self.equipment.get(v.equipment_id) if v.equipment_id else None
        return {
            "id": v.id, "code": v.code, "name": v.name, "variable_type": v.variable_type, "unit": self.unit(v.unit_id),
            "unit_id": v.unit_id, "node": self.node_brief(v.node_id),
            "equipment": {"id": eq.id, "tag": eq.tag, "name": eq.name} if eq else None,
            "carrier": self.carrier(v.energy_carrier_id),
            "data_source": {"id": src.id, "code": src.code, "name": src.name, "kind": src.kind,
                            "protocol": src.protocol, "is_automatic": src.is_automatic} if src else None,
            "source_tag": v.source_tag, "collection_frequency": v.collection_frequency,
            "is_automatic": v.is_automatic, "measurement_method": v.measurement_method,
            "aggregation": v.aggregation, "counts_toward_total": v.counts_toward_total, "notes": v.notes,
        }

    def indicator(self, i: Indicator, detail: bool = False) -> dict:
        eq = self.equipment.get(i.equipment_id) if i.equipment_id else None
        u = self.uses.get(i.use_id) if i.use_id else None
        level = "equipment" if eq else ("use" if u else "process")
        sources = {self.sources[self.variables[b.variable_id].data_source_id].name
                   for b in i.bindings if b.variable_id and self.variables[b.variable_id].data_source_id}
        auto = [self.variables[b.variable_id].is_automatic for b in i.bindings if b.variable_id]
        out = {
            "id": i.id, "code": i.code, "name": i.name, "description": i.description, "kind": i.kind,
            "category": i.category, "level": level, "formula": i.formula, "unit": self.unit(i.unit_id),
            "unit_id": i.unit_id, "frequency": i.frequency, "direction": i.direction, "decimals": i.decimals,
            "node": self.node_brief(i.node_id), "area": self.area_of(i.node_id), "process": self.process_of(i.node_id),
            "use": {"id": u.id, "code": u.code, "name": u.name, "category": self.category(u.category_id)} if u else None,
            "equipment": {"id": eq.id, "tag": eq.tag, "name": eq.name} if eq else None,
            "responsible": self.person(i.responsible_id), "data_sources": sorted(sources),
            "collection": "automática" if auto and all(auto) else ("manual" if auto and not any(auto) else "mista"),
            "template_id": i.template_id, "active": i.active,
        }
        if detail:
            out.update({
                "path": self.path(i.node_id),
                "status_rule": i.status_rule or {},
                "upper_limit": i.upper_limit, "lower_limit": i.lower_limit,
                "min_completeness_pct": i.min_completeness_pct, "stability_band_pct": i.stability_band_pct,
                "operating_variable": self.variable(self.variables[i.operating_variable_id])
                if i.operating_variable_id else None,
                "operating_variable_id": i.operating_variable_id,
                "baseline_model_id": i.baseline_model_id,
                "baseline_model": self.baseline(self.baselines[i.baseline_model_id]) if i.baseline_model_id in self.baselines else None,
                "data_origin_note": i.data_origin_note,
                "template": {"id": i.template_id, "code": self.templates[i.template_id].code,
                             "name": self.templates[i.template_id].name} if i.template_id in self.templates else None,
                "bindings": [
                    {"id": b.id, "symbol": b.symbol, "source_type": b.source_type, "variable_id": b.variable_id,
                     "variable": self.variable(self.variables[b.variable_id]) if b.variable_id in self.variables else None,
                     "aggregation": b.aggregation, "unit_id": b.unit_id, "unit": self.unit(b.unit_id),
                     "constant_value": b.constant_value, "attribute": b.attribute, "builtin": b.builtin}
                    for b in i.bindings
                ],
                "targets": [
                    {"id": t.id, "valid_from": t.valid_from.isoformat(),
                     "valid_to": t.valid_to.isoformat() if t.valid_to else None, "target_value": t.target_value,
                     "target_min": t.target_min, "target_max": t.target_max, "baseline_value": t.baseline_value,
                     "scope": t.scope, "label": t.label, "justification": t.justification}
                    for t in i.targets
                ],
            })
        return out

    def baseline(self, b: EnergyBaseline) -> dict:
        v = self.variables.get(b.energy_variable_id)
        model = b.model or {}
        return {
            "id": b.id, "code": b.code, "name": b.name, "scope_level": b.scope_level, "model_type": b.model_type,
            "node": self.node_brief(b.node_id), "use_id": b.use_id, "equipment_id": b.equipment_id,
            "energy_variable": {"id": v.id, "code": v.code, "name": v.name, "unit": self.unit(v.unit_id)} if v else None,
            "period_start": b.period_start.isoformat(), "period_end": b.period_end.isoformat(),
            "status": b.status, "notes": b.notes,
            "model": {
                **model,
                "variable_details": {
                    s: {"id": vid, "code": self.variables[int(vid)].code, "name": self.variables[int(vid)].name,
                        "unit": self.unit(self.variables[int(vid)].unit_id)}
                    for s, vid in model.get("variables", {}).items() if int(vid) in self.variables
                },
            },
        }
