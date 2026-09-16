"""Consolidação de energia por nó da hierarquia, USE, equipamento e fonte.

Regras (evitam dupla contagem):
- Total do nó = variáveis de energia com counts_toward_total na subárvore (medidores de CCM, combustível...).
  Sem medidor de total na subárvore (ex.: subprocesso), usa-se a soma das submedições dos equipamentos.
- Energia secundária (kind=internal, ex.: vapor) só entra no total se NÃO for gerada dentro da própria
  subárvore. Recebimento (que contém a Caldeira) soma a biomassa e não o vapor; o Secador isolado soma o vapor.
- Tudo é convertido para MWh pela energia específica cadastrada na fonte (ex.: 11 GJ/t de biomassa).
- "Não alocado" = total medido no CCM − Σ submedições dos USEs (transparência de medição).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.periods import ResolvedPeriod, bucket_label, iter_buckets
from app.engine.repository import SeriesRepository
from app.engine.stats import pct_change
from app.engine.units import UnitInfo, convert
from app.models import (
    EnergyCarrier,
    Equipment,
    HierarchyNode,
    SignificantEnergyUse,
    Unit,
    UseCategory,
    Variable,
)

ENERGY_TYPES = ("energy",)


@dataclass
class EVar:
    id: int
    code: str
    name: str
    node_id: int | None
    equipment_id: int | None
    use_id: int | None
    carrier_id: int | None
    counts: bool
    unit_id: int
    variable_type: str


class EnergyService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = SeriesRepository(db)
        self.nodes = {n.id: n for n in db.scalars(select(HierarchyNode).where(HierarchyNode.active.is_(True)))}
        self.carriers = {c.id: c for c in db.scalars(select(EnergyCarrier))}
        self.units = {u.id: UnitInfo(u.id, u.symbol, u.quantity, u.factor_to_base, u.offset_to_base) for u in db.scalars(select(Unit))}
        self.uses = {u.id: u for u in db.scalars(select(SignificantEnergyUse).where(SignificantEnergyUse.active.is_(True)))}
        self.categories = {c.id: c for c in db.scalars(select(UseCategory))}
        eq_use = dict(db.execute(select(Equipment.id, Equipment.use_id)).all())
        self.equipment_names = dict(db.execute(select(Equipment.id, Equipment.name)).all())
        self.vars: list[EVar] = []
        self.production_vars: list[EVar] = []
        for v in db.scalars(select(Variable).where(Variable.variable_type.in_(("energy", "production")))):
            ev = EVar(v.id, v.code, v.name, v.node_id, v.equipment_id, eq_use.get(v.equipment_id), v.energy_carrier_id,
                      v.counts_toward_total, v.unit_id, v.variable_type)
            (self.vars if v.variable_type == "energy" else self.production_vars).append(ev)

    # ------------------------------------------------------------------ utilidades
    def subtree(self, node: HierarchyNode) -> set[int]:
        return {i for i, n in self.nodes.items() if n.path.startswith(node.path)}

    def _mwh(self, v: EVar, value: float) -> float:
        c = self.carriers.get(v.carrier_id)
        if c is None:
            return 0.0
        native = convert(value, self.units[v.unit_id], self.units[c.unit_id]) if v.unit_id != c.unit_id else value
        return native * c.kwh_per_unit / 1000.0

    def _generated(self, ids: set[int]) -> set[int]:
        return {p.carrier_id for p in self.production_vars if p.carrier_id and p.node_id in ids}

    def total_vars(self, node: HierarchyNode) -> list[EVar]:
        ids = self.subtree(node)
        in_tree = [v for v in self.vars if v.node_id in ids]
        counted = [v for v in in_tree if v.counts]
        if not counted:
            counted = [v for v in in_tree if v.equipment_id is not None]
        gen = self._generated(ids)
        return [v for v in counted if self.carriers[v.carrier_id].kind == "boundary" or v.carrier_id not in gen]

    def production_var(self, node: HierarchyNode) -> Variable | None:
        n = node
        while n is not None:
            if n.production_variable_id:
                return self.db.get(Variable, n.production_variable_id)
            if n.level not in ("subprocess",):
                return None
            n = self.nodes.get(n.parent_id)
        return None

    # ------------------------------------------------------------------ totais do período
    def summary(self, node: HierarchyNode, period: ResolvedPeriod) -> dict:
        tv = self.total_vars(node)
        prod_var = self.production_var(node)
        ids = [v.id for v in tv] + ([prod_var.id] if prod_var else [])
        aggs = self.repo.period_aggregates(ids, period.eff_start, period.eff_end) if not period.is_empty else {}
        by_carrier: dict[str, dict] = {}
        total = boundary = internal = 0.0
        completeness = []
        for v in tv:
            a = aggs.get(v.id)
            c = self.carriers[v.carrier_id]
            completeness.append(min(100.0, (a.days if a else 0) / period.days * 100) if period.days else 0.0)
            if a is None:
                continue
            mwh = self._mwh(v, a.sum)
            item = by_carrier.setdefault(c.code, {
                "carrier": c.code, "name": c.name, "kind": c.kind, "color_slot": c.color_slot,
                "mwh": 0.0, "native": 0.0, "unit": self.units[c.unit_id].symbol,
            })
            item["mwh"] += mwh
            item["native"] += convert(a.sum, self.units[v.unit_id], self.units[c.unit_id]) if v.unit_id != c.unit_id else a.sum
            total += mwh
            if c.kind == "boundary":
                boundary += mwh
            else:
                internal += mwh
        production = None
        if prod_var and prod_var.id in aggs:
            production = aggs[prod_var.id].sum
        elif prod_var:
            production = None
        intensity = total * 1000 / production if production else None
        return {
            "node_id": node.id,
            "energy_mwh": total if tv else None,
            "boundary_mwh": boundary,
            "internal_mwh": internal,
            "by_carrier": sorted(by_carrier.values(), key=lambda x: x["color_slot"]),
            "production": production,
            "production_unit": self.units[prod_var.unit_id].symbol if prod_var else None,
            "production_name": prod_var.name if prod_var else None,
            "intensity_kwh_per_unit": intensity,
            "intensity_unit": f"kWh/{self.units[prod_var.unit_id].symbol}" if prod_var else None,
            "completeness_pct": round(min(completeness), 1) if completeness else None,
            "metering": "medidor de total" if any(v.counts for v in tv) else ("submedição" if tv else "sem medição"),
        }

    def summary_compare(self, node: HierarchyNode, a: ResolvedPeriod, b: ResolvedPeriod) -> dict:
        from app.engine.stats import lmdi

        sa, sb = self.summary(node, a), self.summary(node, b)
        decomposition = None
        if sa["energy_mwh"] and sb["energy_mwh"] and sa["production"] and sb["production"]:
            decomposition = lmdi(sb["energy_mwh"], sa["energy_mwh"], sb["production"], sa["production"])
        return {
            "current": sa,
            "previous": sb,
            "energy_delta_pct": pct_change(sa["energy_mwh"], sb["energy_mwh"]),
            "production_delta_pct": pct_change(sa["production"], sb["production"]),
            "intensity_delta_pct": pct_change(sa["intensity_kwh_per_unit"], sb["intensity_kwh_per_unit"]),
            "decomposition": decomposition,
        }

    # ------------------------------------------------------------------ distribuições
    def by_children(self, node: HierarchyNode, period: ResolvedPeriod) -> list[dict]:
        kids = sorted([n for n in self.nodes.values() if n.parent_id == node.id], key=lambda n: n.sort_order)
        return [{"id": k.id, "code": k.code, "name": k.name, "level": k.level, "color_slot": k.color_slot,
                 **self.summary(k, period)} for k in kids]

    def by_use(self, node: HierarchyNode, period: ResolvedPeriod) -> dict:
        ids = self.subtree(node)
        gen = self._generated(ids)
        use_vars = [v for v in self.vars if v.use_id is not None and v.node_id in ids]
        total_vars = self.total_vars(node)
        all_ids = [v.id for v in use_vars] + [v.id for v in total_vars]
        aggs = self.repo.period_aggregates(all_ids, period.eff_start, period.eff_end) if not period.is_empty else {}
        rows: dict[int, dict] = {}
        alloc_by_carrier: dict[int, float] = defaultdict(float)
        for v in use_vars:
            c = self.carriers[v.carrier_id]
            if c.kind == "internal" and v.carrier_id in gen:
                continue
            a = aggs.get(v.id)
            use = self.uses.get(v.use_id)
            if use is None:
                continue
            cat = self.categories[use.category_id]
            r = rows.setdefault(use.id, {
                "use_id": use.id, "code": use.code, "name": use.name, "node_id": use.node_id,
                "node_name": self.nodes[use.node_id].name if use.node_id in self.nodes else None,
                "category_id": cat.id, "category": cat.name, "category_code": cat.code, "color_slot": cat.color_slot,
                "operating_regime": use.operating_regime, "mwh": 0.0, "carriers": set(), "equipment_count": 0,
                "internal": False,
            })
            r["carriers"].add(c.code)
            r["internal"] = r["internal"] or c.kind == "internal"
            if a:
                mwh = self._mwh(v, a.sum)
                r["mwh"] += mwh
                alloc_by_carrier[v.carrier_id] += mwh
        eq_count = defaultdict(int)
        for eq_id, use_id in self.db.execute(select(Equipment.id, Equipment.use_id)).all():
            eq_count[use_id] += 1
        for r in rows.values():
            r["carriers"] = sorted(r["carriers"])
            r["equipment_count"] = eq_count.get(r["use_id"], 0)
        # não alocado por fonte (somente onde há medidor de total)
        unallocated = []
        measured_by_carrier: dict[int, float] = defaultdict(float)
        for v in total_vars:
            if v.counts and aggs.get(v.id):
                measured_by_carrier[v.carrier_id] += self._mwh(v, aggs[v.id].sum)
        for cid, measured in measured_by_carrier.items():
            diff = measured - alloc_by_carrier.get(cid, 0.0)
            c = self.carriers[cid]
            unallocated.append({"carrier": c.code, "name": c.name, "measured_mwh": measured,
                                "allocated_mwh": alloc_by_carrier.get(cid, 0.0), "unallocated_mwh": diff,
                                "inconsistent": diff < -0.005 * measured})
        total = sum(r["mwh"] for r in rows.values()) + sum(max(0.0, u["unallocated_mwh"]) for u in unallocated)
        items = sorted(rows.values(), key=lambda r: -r["mwh"])
        for r in items:
            r["share_pct"] = r["mwh"] / total * 100 if total else None
        cats: dict[int, dict] = {}
        for r in items:
            cat = cats.setdefault(r["category_id"], {"category_id": r["category_id"], "name": r["category"],
                                                     "code": r["category_code"], "color_slot": r["color_slot"],
                                                     "mwh": 0.0, "uses": 0})
            cat["mwh"] += r["mwh"]
            cat["uses"] += 1
        for c in cats.values():
            c["share_pct"] = c["mwh"] / total * 100 if total else None
        return {
            "uses": items,
            "categories": sorted(cats.values(), key=lambda c: -c["mwh"]),
            "unallocated": unallocated,
            "total_mwh": total,
        }

    def by_equipment(self, use: SignificantEnergyUse, period: ResolvedPeriod) -> dict[int, float]:
        vs = [v for v in self.vars if v.use_id == use.id]
        aggs = self.repo.period_aggregates([v.id for v in vs], period.eff_start, period.eff_end)
        out: dict[int, float] = defaultdict(float)
        for v in vs:
            if aggs.get(v.id):
                out[v.equipment_id] += self._mwh(v, aggs[v.id].sum)
        return out

    # ------------------------------------------------------------------ séries
    def series(self, node: HierarchyNode, start: date, end: date, grain: str, group: str = "child") -> dict:
        """Energia (MWh) por bucket, agrupada por filho ou por fonte, + produção de referência."""
        groups: dict[str, dict] = {}
        var_group: dict[int, str] = {}
        if group == "child":
            kids = sorted([n for n in self.nodes.values() if n.parent_id == node.id], key=lambda n: n.sort_order)
            if not kids:
                kids = [node]
            for k in kids:
                groups[str(k.id)] = {"key": str(k.id), "name": k.name, "color_slot": k.color_slot}
                for v in self.total_vars(k):
                    var_group[v.id] = str(k.id)
            # quando o agrupamento por filho não contempla dupla contagem, mantém cada filho com sua regra
        else:
            for v in self.total_vars(node):
                c = self.carriers[v.carrier_id]
                groups.setdefault(c.code, {"key": c.code, "name": c.name, "color_slot": c.color_slot})
                var_group[v.id] = c.code
        evars = {v.id: v for v in self.vars}
        prod_var = self.production_var(node)
        ids = list(var_group) + ([prod_var.id] if prod_var else [])
        daily = self.repo.daily(ids, start, end)
        buckets = iter_buckets(start, end, grain)
        out_groups = []
        for key, g in groups.items():
            values = []
            for b0, b1 in buckets:
                s, has = 0.0, False
                for vid, gk in var_group.items():
                    if gk != key:
                        continue
                    for day, st in daily.get(vid, {}).items():
                        if b0 <= day <= b1:
                            s += self._mwh(evars[vid], st.sum)
                            has = True
                values.append(s if has else None)
            out_groups.append({**g, "values": values})
        production = []
        if prod_var:
            for b0, b1 in buckets:
                vals = [st.sum for day, st in daily.get(prod_var.id, {}).items() if b0 <= day <= b1]
                production.append(sum(vals) if vals else None)
        totals = []
        for i in range(len(buckets)):
            vals = [g["values"][i] for g in out_groups if g["values"][i] is not None]
            totals.append(sum(vals) if vals else None)
        intensity = [
            (t * 1000 / p) if (t is not None and p) else None for t, p in zip(totals, production or [None] * len(totals))
        ]
        return {
            "grain": grain,
            "buckets": [{"start": b0.isoformat(), "end": b1.isoformat(), "label": bucket_label(b0, grain)} for b0, b1 in buckets],
            "groups": out_groups,
            "total": totals,
            "production": production if prod_var else None,
            "production_unit": self.units[prod_var.unit_id].symbol if prod_var else None,
            "intensity": intensity if prod_var else None,
        }

    # ------------------------------------------------------------------ Sankey
    def sankey(self, node: HierarchyNode, period: ResolvedPeriod) -> dict:
        """Fontes → áreas → processos → categorias de USE (com vapor Caldeira → Secador e perdas de conversão)."""
        nodes: dict[str, dict] = {}
        links: list[dict] = []

        def add_node(name: str, kind: str, ref: int | None = None, color_slot: int | None = None):
            nodes.setdefault(name, {"name": name, "kind": kind, "ref": ref, "color_slot": color_slot})

        def add_link(src: str, dst: str, value: float, carrier: str | None = None):
            if value and value > 1e-6:
                links.append({"source": src, "target": dst, "value": value, "carrier": carrier})

        level_order = ["company", "plant", "area", "process", "subprocess"]
        start_level = node.level
        areas = [n for n in self.nodes.values() if n.level == "area" and n.path.startswith(node.path)]
        if start_level in ("area",):
            areas = [node]
        procs_all = [n for n in self.nodes.values() if n.level == "process"]
        if start_level in ("process", "subprocess"):
            areas, procs_all = [], [node]

        for area in sorted(areas, key=lambda n: n.sort_order):
            add_node(area.name, "area", area.id, area.color_slot)
            for v in self.total_vars(area):
                c = self.carriers[v.carrier_id]
                add_node(c.name, "carrier", c.id, c.color_slot)
            aggs = self.repo.period_aggregates([v.id for v in self.total_vars(area)], period.eff_start, period.eff_end)
            per_carrier = defaultdict(float)
            for v in self.total_vars(area):
                if aggs.get(v.id):
                    per_carrier[self.carriers[v.carrier_id].name] += self._mwh(v, aggs[v.id].sum)
            for cname, val in per_carrier.items():
                add_link(cname, area.name, val)

        target_procs = [p for p in procs_all if any(p.parent_id == a.id for a in areas)] if areas else procs_all
        steam_sources: dict[int, float] = {}
        for proc in sorted(target_procs, key=lambda n: (n.parent_id or 0, n.sort_order)):
            ids = self.subtree(proc)
            add_node(proc.name, "process", proc.id)
            boundary_vars = [v for v in self.total_vars(proc) if self.carriers[v.carrier_id].kind == "boundary"]
            aggs = self.repo.period_aggregates([v.id for v in self.vars if v.node_id in ids] +
                                               [p.id for p in self.production_vars if p.node_id in ids],
                                               period.eff_start, period.eff_end)
            boundary = sum(self._mwh(v, aggs[v.id].sum) for v in boundary_vars if aggs.get(v.id))
            parent = self.nodes.get(proc.parent_id)
            if areas and parent is not None:
                add_link(parent.name, proc.name, boundary)
            elif not areas:
                for v in boundary_vars:
                    c = self.carriers[v.carrier_id]
                    add_node(c.name, "carrier", c.id, c.color_slot)
                    if aggs.get(v.id):
                        add_link(c.name, proc.name, self._mwh(v, aggs[v.id].sum))
            # vapor gerado
            for p in self.production_vars:
                if p.node_id in ids and p.carrier_id and self.carriers[p.carrier_id].kind == "internal" and aggs.get(p.id):
                    c = self.carriers[p.carrier_id]
                    if c.code == "ar_comprimido":
                        continue
                    steam_sources[proc.id] = self._mwh(p, aggs[p.id].sum)
            # consumo por USE
            breakdown = self.by_use(proc, period)
            fuel_to_conversion = 0.0
            for u in breakdown["uses"]:
                use = self.uses[u["use_id"]]
                cat = self.categories[use.category_id]
                if proc.id in steam_sources and self.carriers[use.energy_carrier_id].kind == "boundary" and \
                        self.carriers[use.energy_carrier_id].code != "eletricidade":
                    fuel_to_conversion += u["mwh"]
                    continue
                if u["internal"]:
                    continue
                add_node(cat.name, "category", cat.id, cat.color_slot)
                add_link(proc.name, cat.name, u["mwh"])
            for un in breakdown["unallocated"]:
                if un["unallocated_mwh"] > 0 and self.carriers_by_code(un["carrier"]).kind == "boundary":
                    add_node("Cargas não submedidas", "unallocated")
                    add_link(proc.name, "Cargas não submedidas", un["unallocated_mwh"])
            if proc.id in steam_sources:
                steam = steam_sources[proc.id]
                add_node("Vapor gerado", "internal")
                add_link(proc.name, "Vapor gerado", steam)
                add_node("Perdas na geração de vapor", "loss")
                add_link(proc.name, "Perdas na geração de vapor", max(0.0, fuel_to_conversion - steam))

        # vapor consumido pelos processos que não o geram
        if steam_sources:
            for proc in target_procs:
                if proc.id in steam_sources:
                    continue
                breakdown = self.by_use(proc, period)
                for u in breakdown["uses"]:
                    if u["internal"] and u["mwh"] > 0:
                        cat = self.categories[self.uses[u["use_id"]].category_id]
                        add_node(proc.name + " ", "process_thermal", proc.id)
                        add_link("Vapor gerado", proc.name + " ", u["mwh"])
                        add_node(cat.name, "category", cat.id, cat.color_slot)
                        add_link(proc.name + " ", cat.name, u["mwh"])
        used = {l["source"] for l in links} | {l["target"] for l in links}
        return {"nodes": [n for k, n in nodes.items() if k in used], "links": links, "unit": "MWh"}

    def carriers_by_code(self, code: str) -> EnergyCarrier:
        return next(c for c in self.carriers.values() if c.code == code)
