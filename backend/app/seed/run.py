"""Carga completa da base DEMO.  Uso:  python -m app.seed.run  [--keep]

Recria o schema, cadastra master data, simula 3 anos de séries temporais, instancia os IDEs,
ajusta linhas de base, calcula metas a partir da baseline do Crop Year 2025 e registra
oportunidades de exemplo. Todos os dados são FICTÍCIOS (MOCK DATA).
"""
from __future__ import annotations

import argparse
import hashlib
import math
import os
import time
from datetime import date, datetime, time as dtime, timedelta

import numpy as np
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, init_db
from app.engine.indicators import IndicatorEngine
from app.engine.repository import cache
from app.models import (
    AppUser, Batch, CropYear, DataSource, EnergyBaseline, EnergyCarrier, Equipment, FlowEdge, FlowNode,
    HierarchyLevel, HierarchyNode, Indicator, IndicatorBinding, IndicatorTarget, IndicatorTemplate,
    Measurement, OperationalEvent, Opportunity, Person, Product, Season, Shift, SignificantEnergyUse, Unit,
    UseCategory, UseRelevantVariable, UserNodeScope, Variable,
)
from app.seed import catalog as cat
from app.seed.indicators import TEMPLATES, IndicatorSpec, motor_indicator, special_indicators, use_indicators
from app.seed.simulate import DAYS, PlantSimulator
from app.services import baselines as bl_service
from app.services.context import period_context


def _bulk_insert_measurements(db: Session, rows: list[dict]) -> None:
    """COPY no PostgreSQL (rápido inclusive contra banco remoto); lotes no SQLite."""
    if db.bind.dialect.name == "postgresql":
        raw = db.connection().connection
        with raw.cursor().copy(
            "COPY measurement (variable_id, ts, value, quality, source) FROM STDIN"
        ) as copy:
            for r in rows:
                copy.write_row((r["variable_id"], r["ts"], r["value"], r["quality"], r["source"]))
        return
    for k in range(0, len(rows), 20000):
        db.execute(insert(Measurement), rows[k:k + 20000])


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2_sha256$200000${salt.hex()}${digest.hex()}"


PROD_NAMES = {
    "REC-DSP": "Espigas recebidas e despalhadas", "REC-DEB": "Espigas debulhadas",
    "REC-SEC": "Grão seco produzido", "TOR-LIM": "Sementes limpas", "TOR-CLA": "Sementes classificadas",
    "TOR-TRA": "Sementes tratadas", "TOR-ENS": "Sementes ensacadas",
}


def seed(db: Session) -> None:
    t0 = time.time()
    log = lambda msg: print(f"[{time.time() - t0:6.1f}s] {msg}")  # noqa: E731

    # ------------------------------------------------------------------ catálogos
    for code, name, depth, has_flow, allows_uses in cat.LEVELS:
        db.add(HierarchyLevel(code=code, name=name, depth=depth, has_flow=has_flow, allows_uses=allows_uses))
    units = {}
    for sym, name, qty, factor in cat.UNITS:
        u = Unit(symbol=sym, name=name, quantity=qty, factor_to_base=factor)
        db.add(u)
        units[sym] = u
    db.flush()
    carriers = {}
    for code, name, kind, unit, kwh, slot, desc in cat.CARRIERS:
        c = EnergyCarrier(code=code, name=name, kind=kind, unit_id=units[unit].id, kwh_per_unit=kwh, color_slot=slot,
                          description=desc)
        db.add(c)
        carriers[code] = c
    categories = {}
    for i, (code, name, icon, slot, desc) in enumerate(cat.USE_CATEGORIES):
        c = UseCategory(code=code, name=name, icon=icon, color_slot=slot, sort_order=i, description=desc)
        db.add(c)
        categories[code] = c
    sources = {}
    for code, name, kind, protocol, auto, desc in cat.DATA_SOURCES:
        s = DataSource(code=code, name=name, kind=kind, protocol=protocol, is_automatic=auto, description=desc)
        db.add(s)
        sources[code] = s
    people = []
    for name, role, email in cat.PEOPLE:
        p = Person(name=name, role_title=role, email=email)
        db.add(p)
        people.append(p)
    db.flush()

    # ------------------------------------------------------------------ hierarquia
    nodes: dict[str, HierarchyNode] = {}
    for code, name, level, parent, order, owner, color, regime, desc in cat.NODES:
        n = HierarchyNode(code=code, name=name, level=level, parent_id=nodes[parent].id if parent else None,
                          sort_order=order, owner_id=people[owner].id, color_slot=color, operating_regime=regime,
                          description=desc, attributes={})
        db.add(n)
        db.flush()
        n.path = f"{nodes[parent].path if parent else '/'}{n.id}/"
        nodes[code] = n
    db.flush()
    log("hierarquia")

    # ------------------------------------------------------------------ USEs e equipamentos
    uses: dict[str, SignificantEnergyUse] = {}
    for code, name, catg, node, carrier, regime, period, resp, reason in cat.USES:
        u = SignificantEnergyUse(code=code, name=name, category_id=categories[catg].id, node_id=nodes[node].id,
                                 energy_carrier_id=carriers[carrier].id, operating_regime=regime,
                                 operating_period=period, responsible_id=people[resp].id, significance_reason=reason,
                                 description=reason)
        db.add(u)
        uses[code] = u
    db.flush()
    equipment: dict[str, Equipment] = {}
    for m in cat.MOTORS:
        e = Equipment(tag=m.tag, name=m.name, use_id=uses[m.use].id, equipment_type=m.equipment_type,
                      manufacturer=m.manufacturer, model=f"Modelo {m.tag[-6:]}", rated_power_kw=m.pn,
                      rated_efficiency_pct=m.eta, efficiency_class=m.eff_class, has_vfd=m.vfd,
                      commissioning_year=m.year,
                      attributes={"tensao_nominal_v": m.voltage,
                                  "corrente_nominal_a": round(m.pn * 1000 / (math.sqrt(3) * m.voltage * m.pf * m.eta / 100), 1),
                                  "fator_potencia_nominal": m.pf, "polos": 4})
        db.add(e)
        equipment[m.tag] = e
    for tag, name, use, etype, pn, eta, eclass, vfd, year, attrs in cat.SPECIAL_EQUIPMENT:
        e = Equipment(tag=tag, name=name, use_id=uses[use].id, equipment_type=etype, manufacturer="Fabricante DEMO",
                      model=f"Modelo {tag[-6:]}", rated_power_kw=pn, rated_efficiency_pct=eta,
                      efficiency_class=eclass, has_vfd=vfd, commissioning_year=year, attributes=attrs)
        db.add(e)
        equipment[tag] = e
    db.flush()
    log("USEs e equipamentos")

    # ------------------------------------------------------------------ variáveis
    variables: dict[str, Variable] = {}
    proc_of_prefix = {v: k for k, v in cat.PROC_PREFIX.items()}

    def add_var(code, name, vtype, unit, node, source, agg="sum", carrier=None, counts=False, equip=None,
                freq="1d", method="measured", auto=True, source_tag=None, notes=None):
        v = Variable(code=code, name=name, variable_type=vtype, unit_id=units[unit].id, node_id=nodes[node].id,
                     equipment_id=equipment[equip].id if equip else None,
                     energy_carrier_id=carriers[carrier].id if carrier else None, data_source_id=sources[source].id,
                     source_tag=source_tag or f"DEMO.{code}", collection_frequency=freq, is_automatic=auto,
                     measurement_method=method, aggregation=agg, counts_toward_total=counts, notes=notes)
        db.add(v)
        variables[code] = v
        return v

    for proc, pre in cat.PROC_PREFIX.items():
        pname = nodes[proc].name
        if pre in PROD_NAMES:
            add_var(f"{pre}.PROD", f"{PROD_NAMES[pre]} (t)", "production", "t", proc, "MES", source_tag=f"MES/{pre}/TON")
        add_var(f"{pre}.EAT", f"Energia ativa — CCM {pname}", "energy", "kWh", proc, "MED", carrier="eletricidade",
                counts=True, freq="15min", source_tag=f"MM-{pre}-CCM.kWh")
        add_var(f"{pre}.ESP", f"Energia sem produção — {pname}", "energy_state", "kWh", proc, "HIST",
                carrier="eletricidade", method="calculated",
                notes="Energia do CCM integrada nas horas sem fluxo de produto (estado calculado no historiador).")
        add_var(f"{pre}.HPROD", f"Horas produtivas — {pname}", "operational", "h", proc, "HIST")
    add_var("REC-SEC.PUMIDO", "Grão úmido na entrada do secador (t)", "production", "t", "rec.secador", "MES")
    add_var("REC-SEC.AGUA", "Água removida na secagem (t)", "process_condition", "t", "rec.secador", "CALC",
            method="calculated")
    add_var("REC-SEC.UIN", "Umidade de entrada do grão", "process_condition", "%", "rec.secador", "LAB", agg="avg",
            freq="turno", auto=False, method="measured", notes="Média das análises por turno (planilha do laboratório).")
    add_var("REC-SEC.UOUT", "Umidade de saída do grão", "process_condition", "%", "rec.secador", "LAB", agg="avg",
            freq="turno", auto=False)
    add_var("REC-SEC.TAMB", "Temperatura ambiente", "process_condition", "°C", "rec.secador", "HIST", agg="avg",
            freq="1min")
    add_var("TOR-CLA.DESC", "Descarte da classificação (t)", "production", "t", "tor.classificacao", "MES")
    add_var("TOR-TRA.LOTES", "Lotes tratados", "production", "lote", "tor.tratamento", "MES")
    add_var("TOR-ENS.SACOS", "Sacos produzidos", "production", "sc", "tor.ensaque", "MES")
    add_var("TOR-ENS.AR", "Ar comprimido entregue à rede", "production", "Nm³", "tor.ensaque", "HIST",
            carrier="ar_comprimido", freq="1min", source_tag="FT-AR-HEADER.Nm3")
    add_var("TOR-ENS.PRESS", "Pressão média na rede de ar", "process_condition", "bar", "tor.ensaque", "HIST",
            agg="avg", freq="1min")

    estimated = {"REC-DEB-TRP-01", "TOR-TRA-BOM-01", "TOR-ENS-TRP-01"}
    motor_like = [(m.tag, m.use) for m in cat.MOTORS] + [("TOR-ENS-CMP-01", "USE-ENS-AR"), ("TOR-ENS-CMP-02", "USE-ENS-AR")]
    use_node_code = {u[0]: u[3] for u in cat.USES}
    for tag, use in motor_like:
        node = use_node_code[use]
        est = tag in estimated
        add_var(f"{tag}.EAT", f"Energia ativa — {equipment[tag].name}", "energy", "kWh", node,
                "CALC" if est else "MED", carrier="eletricidade", equip=tag, freq="15min",
                method="estimated" if est else "measured",
                notes="Estimado: potência nominal × horas × fator de carga típico." if est else None)
        add_var(f"{tag}.HOP", f"Horas em operação — {equipment[tag].name}", "operational", "h", node, "HIST", equip=tag)
        add_var(f"{tag}.HVZ", f"Horas em vazio — {equipment[tag].name}", "operational", "h", node, "HIST", equip=tag)
        add_var(f"{tag}.EVZ", f"Energia em vazio — {equipment[tag].name}", "energy_state", "kWh", node, "HIST",
                carrier="eletricidade", equip=tag, method="calculated")
        add_var(f"{tag}.FP", f"Fator de potência — {equipment[tag].name}", "electrical", "-", node,
                "CALC" if est else "MED", agg="avg", equip=tag, freq="15min")
        add_var(f"{tag}.IMED", f"Corrente média — {equipment[tag].name}", "electrical", "A", node,
                "CALC" if est else "MED", agg="avg", equip=tag, freq="15min")
        add_var(f"{tag}.NPART", f"Partidas — {equipment[tag].name}", "operational", "partidas", node, "HIST",
                equip=tag)
    add_var("REC-SEC-TRC-01.VAP", "Vapor consumido pelo secador", "energy", "t", "rec.secador", "HIST",
            carrier="vapor", counts=True, equip="REC-SEC-TRC-01", freq="1min", source_tag="FT-VAP-SEC.t")
    add_var("REC-SEC-TRC-01.HOP", "Horas em operação — trocadores do secador", "operational", "h", "rec.secador",
            "HIST", equip="REC-SEC-TRC-01")
    add_var("REC-CAL-GER-01.BIO", "Biomassa consumida (balança)", "energy", "t", "rec.caldeira", "MES",
            carrier="biomassa", counts=True, equip="REC-CAL-GER-01", source_tag="BAL-BIO-01.t")
    add_var("REC-CAL-GER-01.VAP", "Vapor produzido", "production", "t", "rec.caldeira", "HIST", carrier="vapor",
            equip="REC-CAL-GER-01", freq="1min", source_tag="FT-VAP-CB01.t")
    add_var("REC-CAL-GER-01.TG", "Temperatura dos gases de exaustão", "process_condition", "°C", "rec.caldeira",
            "HIST", agg="avg", equip="REC-CAL-GER-01", freq="1min")
    add_var("REC-CAL-GER-01.O2", "O₂ nos gases de combustão", "process_condition", "%", "rec.caldeira", "HIST",
            agg="avg", equip="REC-CAL-GER-01", freq="1min")
    add_var("REC-CAL-GER-01.HOP", "Horas em operação — caldeira", "operational", "h", "rec.caldeira", "HIST",
            equip="REC-CAL-GER-01")
    db.flush()

    # produção de referência por nó
    prod_ref = {"planta-demo": "REC-SEC.PROD", "recebimento": "REC-SEC.PROD", "torre": "TOR-CLA.PROD", "rec.caldeira": "REC-CAL-GER-01.VAP",
                "tor.tratamento.calda": "TOR-TRA.PROD", "tor.tratamento.aplicacao": "TOR-TRA.PROD",
                "tor.ensaque.ensacamento": "TOR-ENS.PROD", "tor.ensaque.paletizacao": "TOR-ENS.PROD"}
    for proc, pre in cat.PROC_PREFIX.items():
        if f"{pre}.PROD" in variables:
            prod_ref.setdefault(proc, f"{pre}.PROD")
    for node, var in prod_ref.items():
        nodes[node].production_variable_id = variables[var].id

    relevant = {
        "USE-SEC-TER": [("REC-SEC.AGUA", "Água removida define a carga térmica."),
                        ("REC-SEC.UIN", "Umidade de entrada varia por safra e clima."),
                        ("REC-SEC.TAMB", "Ar ambiente mais frio exige mais energia.")],
        "USE-SEC-VEN": [("REC-SEC.PUMIDO", "Massa de grão nas câmaras."), ("REC-SEC-TRC-01.HOP", "Horas de secagem.")],
        "USE-CAL-GER": [("REC-CAL-GER-01.VAP", "Demanda de vapor do secador."),
                        ("REC-CAL-GER-01.O2", "Excesso de ar afeta o rendimento.")],
        "USE-ENS-AR": [("TOR-ENS.SACOS", "Consumo das ensacadeiras."), ("TOR-LIM.PROD", "Pulsos do filtro de mangas."),
                       ("TOR-ENS.PRESS", "Pressão de operação.")],
        "USE-DSP-ACI": [("REC-DSP.PROD", "Toneladas processadas.")],
        "USE-DEB-ACI": [("REC-DEB.PROD", "Toneladas processadas.")],
        "USE-LIM-ASP": [("TOR-LIM.PROD", "Toneladas processadas.")],
    }
    for use, items in relevant.items():
        for code, why in items:
            db.add(UseRelevantVariable(use_id=uses[use].id, variable_id=variables[code].id, rationale=why))
    db.flush()
    log(f"variáveis: {len(variables)}")

    # ------------------------------------------------------------------ fluxogramas
    def flow(diagram: str, spec_nodes: list[tuple], spec_edges: list[tuple]):
        fn = {}
        for i, (key, kind, label, hnode, link, x, y) in enumerate(spec_nodes):
            f = FlowNode(diagram_node_id=nodes[diagram].id, kind=kind, label=label,
                         hierarchy_node_id=nodes[hnode].id if hnode else None,
                         linked_node_id=nodes[link].id if link else None, pos_x=x, pos_y=y, sort_order=i)
            db.add(f)
            fn[key] = f
        db.flush()
        for src, dst, stype, label, carrier in spec_edges:
            db.add(FlowEdge(diagram_node_id=nodes[diagram].id, source_id=fn[src].id, target_id=fn[dst].id,
                            stream_type=stype, label=label,
                            energy_carrier_id=carriers[carrier].id if carrier else None))

    flow("recebimento",
         [("in", "input", "Espigas com palha (campo)", None, None, 0, 60),
          ("dsp", "process", "Despalha", "rec.despalha", None, 230, 40),
          ("deb", "process", "Debulha", "rec.debulha", None, 500, 40),
          ("sec", "process", "Secador", "rec.secador", None, 770, 40),
          ("out", "link", "Grãos secos → Torre", None, "torre", 1050, 60),
          ("palha", "output", "Palha (resíduo)", None, None, 250, 230),
          ("bio", "input", "Cavaco de madeira", None, None, 500, 300),
          ("cal", "process", "Caldeira", "rec.caldeira", None, 770, 280)],
         [("in", "dsp", "material", "Espigas com palha", None),
          ("dsp", "deb", "material", "Espigas despalhadas", None),
          ("dsp", "palha", "residue", "Palha", None),
          ("deb", "sec", "material", "Grãos úmidos", None),
          ("deb", "cal", "residue", "Sabugo (combustível)", "biomassa"),
          ("bio", "cal", "energy", "Biomassa", "biomassa"),
          ("cal", "sec", "energy", "Vapor", "vapor"),
          ("sec", "out", "material", "Grãos secos", None)])
    flow("torre",
         [("in", "link", "Grãos secos ← Recebimento", None, "recebimento", 0, 60),
          ("lim", "process", "Limpeza", "tor.limpeza", None, 230, 40),
          ("cla", "process", "Classificação", "tor.classificacao", None, 500, 40),
          ("tra", "process", "Tratamento", "tor.tratamento", None, 770, 40),
          ("ens", "process", "Ensaque", "tor.ensaque", None, 1040, 40),
          ("out", "output", "Expedição (paletes)", None, None, 1320, 60),
          ("imp", "output", "Impurezas", None, None, 250, 230),
          ("desc", "output", "Descarte de classificação", None, None, 520, 230),
          ("quim", "input", "Produtos de tratamento", None, None, 790, 230)],
         [("in", "lim", "material", "Grãos secos", None),
          ("lim", "cla", "material", "Sementes limpas", None),
          ("lim", "imp", "residue", "Impurezas", None),
          ("cla", "tra", "material", "Sementes classificadas", None),
          ("cla", "desc", "residue", "Fora de padrão", None),
          ("quim", "tra", "material", "Calda", None),
          ("tra", "ens", "material", "Sementes tratadas", None),
          ("ens", "out", "material", "Sacos paletizados", None)])
    flow("tor.tratamento",
         [("in", "input", "Sementes classificadas", None, None, 0, 40),
          ("quim", "input", "Produtos químicos", None, None, 0, 300),
          ("cal", "process", "Preparo de calda", "tor.tratamento.calda", None, 280, 280),
          ("apl", "process", "Aplicação", "tor.tratamento.aplicacao", None, 580, 20),
          ("out", "output", "Sementes tratadas → Ensaque", None, None, 900, 40)],
         [("in", "apl", "material", "Sementes", None), ("quim", "cal", "material", "Insumos", None),
          ("cal", "apl", "material", "Calda", None), ("apl", "out", "material", "Sementes tratadas", None)])
    flow("tor.ensaque",
         [("in", "input", "Sementes tratadas", None, None, 0, 40),
          ("ens", "process", "Ensacamento", "tor.ensaque.ensacamento", None, 280, 20),
          ("pal", "process", "Paletização", "tor.ensaque.paletizacao", None, 580, 20),
          ("out", "output", "Expedição", None, None, 900, 40)],
         [("in", "ens", "material", "Sementes", None), ("ens", "pal", "material", "Sacos", None),
          ("pal", "out", "material", "Paletes", None)])
    db.flush()
    log("fluxogramas")

    # ------------------------------------------------------------------ contexto
    cys = {}
    for code, name, s, e in cat.CROP_YEARS:
        c = CropYear(code=code, name=name, start_date=s, end_date=e,
                     notes="Configuração DEMO: 1º set → 31 ago. Ajuste conforme o calendário corporativo.")
        db.add(c)
        cys[code] = c
    db.flush()
    for code, name, stype, cy, s, e in cat.SEASONS:
        db.add(Season(code=code, name=name, season_type=stype, crop_year_id=cys[cy].id, start_date=s, end_date=e))
    shifts = [Shift(name="Turno A", start_time=dtime(6), end_time=dtime(14)),
              Shift(name="Turno B", start_time=dtime(14), end_time=dtime(22)),
              Shift(name="Turno C", start_time=dtime(22), end_time=dtime(6))]
    db.add_all(shifts)
    products = [Product(code=c, name=n) for c, n in cat.PRODUCTS]
    db.add_all(products)
    db.flush()

    # ------------------------------------------------------------------ séries temporais
    sim = PlantSimulator().run()
    rows = []
    for code, arr in sim.values.items():
        v = variables.get(code)
        if v is None:
            raise RuntimeError(f"variável simulada sem cadastro: {code}")
        q = sim.quality.get(code, {})
        source = "manual" if not v.is_automatic else "historian"
        for i in np.where(~np.isnan(arr))[0]:
            quality = q.get(int(i), "good")
            rows.append({"variable_id": v.id, "ts": datetime.combine(DAYS[i], dtime()),
                         "value": None if quality == "bad" else float(round(arr[i], 5)),
                         "quality": quality, "source": source})
    missing_vars = set(variables) - set(sim.values)
    if missing_vars:
        raise RuntimeError(f"variáveis sem simulação: {sorted(missing_vars)}")
    _bulk_insert_measurements(db, rows)
    db.flush()
    log(f"medições: {len(rows)}")

    for ev in sim.events:
        db.add(OperationalEvent(node_id=nodes[ev.node].id if ev.node else None,
                                equipment_id=equipment[ev.equipment].id if ev.equipment else None,
                                event_type=ev.event_type, ts_start=datetime.combine(ev.start, dtime()),
                                ts_end=datetime.combine(ev.end, dtime()) if ev.end else None,
                                description=ev.description))
    seasons = list(db.scalars(select(Season)))
    rng = np.random.default_rng(7)
    lot_rows, seq = [], 0
    for d, n_lots, tons in sim.lots:
        season = next((s for s in seasons if s.start_date <= d <= s.end_date), None)
        for j in range(n_lots):
            seq += 1
            start = datetime.combine(d, dtime(6)) + timedelta(hours=j * 20 / max(n_lots, 1))
            lot_rows.append({"code": f"LT-{d:%y%m%d}-{j + 1:02d}", "product_id": products[int(rng.integers(0, 3))].id,
                             "node_id": nodes["tor.tratamento"].id, "season_id": season.id if season else None,
                             "start_ts": start, "end_ts": start + timedelta(minutes=50),
                             "quantity_t": round(tons / n_lots, 2), "shift_id": shifts[min(2, int(j * 3 / n_lots))].id})
    for k in range(0, len(lot_rows), 5000):
        db.execute(insert(Batch), lot_rows[k:k + 5000])
    db.commit()
    log(f"eventos: {len(sim.events)} · lotes: {len(lot_rows)}")

    # ------------------------------------------------------------------ templates e indicadores
    for code, (name, kind, catg, formula, unit, direction, desc, _dec, symbols) in TEMPLATES.items():
        db.add(IndicatorTemplate(code=f"TPL-{code}", name=name, kind=kind, formula=formula, symbols=symbols,
                                 unit_symbol=unit, direction=direction, description=desc,
                                 use_category_id=None if kind == "extrinsic" else categories["acionamentos"].id))
    extra_templates = [
        ("TPL-TER-GJT", "Consumo específico térmico", "termico", "extrinsic", "V * h / P", "GJ/t",
         {"V": "vapor (t)", "h": "entalpia útil (GJ/t)", "P": "produção (t)"}),
        ("TPL-TER-MJKG", "Energia por água evaporada", "termico", "extrinsic", "V * h / W", "MJ/kg",
         {"V": "vapor (t)", "h": "entalpia útil (GJ/t)", "W": "água removida (t)"}),
        ("TPL-CAL-REND", "Rendimento térmico (método direto)", "caldeira", "intrinsic", "S * hs / (B * PCI) * 100", "%",
         {"S": "vapor (t)", "hs": "entalpia (GJ/t)", "B": "combustível (t)", "PCI": "PCI (GJ/t)"}),
        ("TPL-AR-KWHNM3", "Consumo específico do ar comprimido", "ar_comprimido", "intrinsic", "E / Q", "kWh/Nm³",
         {"E": "energia dos compressores (kWh)", "Q": "ar entregue (Nm³)"}),
    ]
    for code, name, catg, kind, formula, unit, symbols in extra_templates:
        db.add(IndicatorTemplate(code=code, name=name, use_category_id=categories[catg].id, kind=kind, formula=formula,
                                 symbols=symbols, unit_symbol=unit,
                                 direction="higher_better" if "REND" in code else "lower_better"))
    db.flush()
    templates = {t.code: t for t in db.scalars(select(IndicatorTemplate))}

    specs: list[IndicatorSpec] = []
    use_resp = {u[0]: u[7] for u in cat.USES}
    use_proc = {}
    for m in cat.MOTORS:
        use_proc[m.use] = m.proc
    use_proc["USE-ENS-AR"] = "tor.ensaque"
    def prod_var_of(proc: str) -> str:
        pre = cat.PROC_PREFIX[proc]
        return "REC-CAL-GER-01.VAP" if pre == "REC-CAL" else f"{pre}.PROD"

    for m in cat.MOTORS:
        for i, tpl in enumerate(m.indicators):
            specs.append(motor_indicator(tpl, m.tag, m.name, use_node_code[m.use], m.use, prod_var_of(m.proc),
                                         "TOR-TRA.LOTES", "TOR-ENS.SACOS", use_resp[m.use], m.vfd))
    specs += special_indicators()
    uses_equipment = {}
    for tag, use in motor_like:
        uses_equipment.setdefault(use, []).append(tag)
    use_prod = {u: prod_var_of(p) for u, p in use_proc.items()}
    use_prod["USE-ENS-AR"] = "TOR-ENS.PROD"
    specs += use_indicators(uses_equipment, use_node_code, use_prod, use_resp,
                            {u[0] for u in cat.USES if u[4] == "eletricidade"})

    indicators: dict[str, Indicator] = {}
    for s in specs:
        ind = Indicator(
            code=s.code, name=s.name, description=s.description, kind=s.kind, category=s.category,
            template_id=templates[s.template].id if s.template in templates else None, node_id=nodes[s.node].id,
            use_id=uses[s.use].id if s.use else None, equipment_id=equipment[s.equipment].id if s.equipment else None,
            formula=s.formula, unit_id=units[s.unit].id, frequency="1d", direction=s.direction, decimals=s.decimals,
            status_rule=s.status_rule, upper_limit=s.upper_limit, min_completeness_pct=s.min_completeness,
            operating_variable_id=variables[s.operating_variable].id if s.operating_variable else None,
            stability_band_pct=s.stability_band, responsible_id=people[s.responsible].id if s.responsible is not None else None,
            data_origin_note=s.origin_note,
        )
        for sym, b in s.bindings.items():
            ind.bindings.append(IndicatorBinding(
                symbol=sym, source_type=b.source_type, variable_id=variables[b.variable].id if b.variable else None,
                aggregation=b.aggregation, unit_id=units[b.unit].id if b.unit else None, constant_value=b.constant,
                attribute=b.attribute, builtin=b.builtin))
        db.add(ind)
        indicators[s.code] = ind
    db.flush()
    db.commit()
    log(f"indicadores: {len(indicators)}")

    # ------------------------------------------------------------------ linhas de base (regressão)
    cy25 = cys["CY2025"]
    baseline_specs = [
        ("BL-SEC-TER", "Vapor do secador × água removida", "rec.secador", "USE-SEC-TER", "REC-SEC-TRC-01",
         "REC-SEC-TRC-01.VAP", {"W": "REC-SEC.AGUA"}, "REC-SEC.AGUA"),
        ("BL-CAL-BIO", "Biomassa da caldeira × vapor produzido", "rec.caldeira", "USE-CAL-GER", "REC-CAL-GER-01",
         "REC-CAL-GER-01.BIO", {"S": "REC-CAL-GER-01.VAP"}, "REC-CAL-GER-01.VAP"),
        ("BL-DSP-EL", "Energia elétrica da Despalha × espigas processadas", "rec.despalha", None, None,
         "REC-DSP.EAT", {"P": "REC-DSP.PROD"}, "REC-DSP.PROD"),
        ("BL-LIM-EL", "Energia elétrica da Limpeza × sementes limpas", "tor.limpeza", None, None,
         "TOR-LIM.EAT", {"P": "TOR-LIM.PROD"}, "TOR-LIM.PROD"),
        ("BL-ENS-AR", "Ar comprimido × sacos e limpeza", "tor.ensaque", "USE-ENS-AR", None,
         "TOR-ENS.AR", {"S": "TOR-ENS.SACOS", "PL": "TOR-LIM.PROD"}, "TOR-ENS-CMP-01.HOP"),
    ]
    baselines = {}
    for code, name, node, use, equip, energy, rel, filt in baseline_specs:
        b = EnergyBaseline(code=code, name=name, scope_level="equipment" if equip else ("use" if use else "node"),
                           node_id=nodes[node].id, use_id=uses[use].id if use else None,
                           equipment_id=equipment[equip].id if equip else None,
                           energy_variable_id=variables[energy].id, model_type="regression",
                           period_start=cy25.start_date, period_end=cy25.end_date,
                           operating_filter_variable_id=variables[filt].id, status="active",
                           notes="Ajustada em dias de operação do Crop Year 2025 (DEMO).")
        db.add(b)
        db.flush()
        bl_service.fit(db, b, {k: variables[v].id for k, v in rel.items()})
        baselines[code] = b
    for s in specs:
        if s.baseline_model:
            indicators[s.code].baseline_model_id = baselines[s.baseline_model].id
    db.commit()
    log("linhas de base ajustadas")

    # ------------------------------------------------------------------ metas: anual (Crop Year) e por janela de safra
    cache.invalidate()
    ctx = period_context(db)
    engine = IndicatorEngine(db)
    all_inds = IndicatorEngine.load_indicators(db)
    ref_windows = {
        "entressafra": ("Entressafra", date(2024, 9, 16), date(2025, 1, 14)),
        "verao": ("Safra Verão", date(2025, 1, 15), date(2025, 6, 10)),
        "safrinha": ("Safrinha", date(2025, 6, 11), date(2025, 9, 15)),
    }
    base_annual = engine.evaluate(all_inds, ctx.resolve("crop_year:CY2025"))
    base_window = {k: engine.evaluate(all_inds, ctx.resolve(f"custom:{s0.isoformat()}..{e0.isoformat()}"))
                   for k, (_, s0, e0) in ref_windows.items()}
    crop_years = [(c.code, c.start_date, c.end_date) for c in cys.values()]

    def reduction(cy_code: str, pct: float) -> float:
        return {"CY2024": 0.0, "CY2025": 0.0, "CY2026": pct}.get(cy_code, pct * 1.5)

    def cy_of(d: date) -> str:
        return next((c for c, a, b in crop_years if a <= d <= b), "CY2027")

    windows = []
    for y in range(2023, 2028):
        windows += [("verao", date(y, 1, 15), date(y, 6, 10)), ("safrinha", date(y, 6, 11), date(y, 9, 15)),
                    ("entressafra", date(y, 9, 16), date(y + 1, 1, 14))]
    windows = [w for w in windows if w[2] >= cat.DATA_START and w[1] <= date(2027, 8, 31)]

    spec_by_code = {s.code: s for s in specs}
    for ind in all_inds:
        s = spec_by_code[ind.code]
        pol = s.target_policy
        annual = base_annual[ind.id].value
        annual_r = round(annual, 6) if annual is not None else None
        if pol is None:
            ind.targets.append(IndicatorTarget(
                valid_from=cat.DATA_START, baseline_value=annual_r, scope="all", label="Informativo",
                justification="Indicador informativo: sem meta; baseline CY2025 como referência."))
            continue
        if pol[0] == "range":
            ind.targets.append(IndicatorTarget(
                valid_from=cat.DATA_START, target_min=pol[1], target_max=pol[2], baseline_value=annual_r, scope="all",
                label="Faixa operacional", justification=f"Faixa operacional recomendada {pol[1]:g}–{pol[2]:g}."))
            continue
        if pol[0] == "abs":
            ind.targets.append(IndicatorTarget(
                valid_from=cat.DATA_START, target_value=pol[1], baseline_value=annual_r, scope="all",
                label="Referência técnica", justification="Referência técnica definida com o dono do processo."))
            continue
        sign = -1 if ind.direction == "lower_better" else 1
        if annual is not None:
            for code, a, b in crop_years:
                pct = reduction(code, pol[1])
                ind.targets.append(IndicatorTarget(
                    valid_from=max(a, cat.DATA_START), valid_to=b, target_value=annual_r * (1 + sign * pct / 100),
                    baseline_value=annual_r, scope="annual", label=f"Meta anual {code}",
                    justification=(f"{code}: {pct:g}% melhor que a baseline anual do CY2025." if pct
                                   else "Período de referência: meta igual à baseline do CY2025.")))
        for kind, a, b in windows:
            ref = base_window[kind][ind.id].value
            if ref is None:
                continue
            code = cy_of(a)
            pct = reduction(code, pol[1])
            name = ref_windows[kind][0]
            label = f"{name} {a.year}" if kind != "entressafra" else f"{name} {a.year}/{str(a.year + 1)[2:]}"
            ind.targets.append(IndicatorTarget(
                valid_from=max(a, cat.DATA_START), valid_to=b, target_value=round(ref, 6) * (1 + sign * pct / 100),
                baseline_value=round(ref, 6), scope="seasonal", label=label,
                justification=f"Baseline da janela '{name}' do CY2025; meta {pct:g}% melhor ({code})."))
    db.commit()
    log("metas anuais e por safra")

    # ------------------------------------------------------------------ usuários
    demo_password = os.getenv("EE_SEED_PASSWORD", "demo")
    for username, display, role, person, scopes in cat.USERS:
        u = AppUser(username=username, display_name=display, password_hash=hash_password(demo_password), role=role,
                    person_id=people[person].id if person is not None else None)
        db.add(u)
        db.flush()
        for sc in scopes:
            db.add(UserNodeScope(user_id=u.id, node_id=nodes[sc].id))
    db.commit()

    # ------------------------------------------------------------------ oportunidades
    cache.invalidate()
    ctx = period_context(db)
    aug = ctx.resolve("month:2026-08")
    engine = IndicatorEngine(db)
    ops = [
        ("OP-2026-001", "Intertravamento para desligar o Debulhador 02 sem alimentação", "rec.debulha", "USE-DEB-ACI",
         "REC-DEB-MOT-02", "IDE-REC-DEB-MOT-02-VAZ",
         "Tempo em vazio subiu de ~7% para ~22% desde jan/2026; equipamento permanece ligado entre cargas.",
         "Intertravar a partida com o sensor de nível do alimentador e desligar após 5 min sem produto.",
         14.0, 9800, 18000, 1, "alta", "em_analise", date(2026, 10, 30)),
        ("OP-2026-002", "Restabelecer limpeza da caldeira e ajustar excesso de ar", "rec.caldeira", "USE-CAL-GER",
         "REC-CAL-GER-01", "IDE-REC-CAL-REND",
         "Rendimento térmico em queda na Safrinha 2026; O₂ acima da faixa e gases de exaustão mais quentes.",
         "Executar ramonagem, recalibrar analisador de O₂ e ajustar a relação ar/combustível.",
         2100.0, 210000, 45000, 2, "alta", "aprovada", date(2026, 9, 30)),
        ("OP-2026-003", "Substituição das mangas e controle de ΔP do filtro", "tor.limpeza", "USE-LIM-ASP",
         "TOR-LIM-ASP-01", "IDE-TOR-LIM-ASP-01-KWHT",
         "Consumo específico do exaustor subiu ~25% desde jul/2026 (colmatação das mangas).",
         "Trocar mangas, instalar transmissor de ΔP e limpeza por pulso sob demanda.",
         22.0, 15400, 38000, 3, "alta", "identificada", date(2026, 11, 15)),
        ("OP-2026-004", "Campanha de detecção e reparo de vazamentos de ar comprimido", "tor.ensaque", "USE-ENS-AR",
         None, "IDE-TOR-ENS-AR-NM3SC",
         "Ar por saco em alta ao longo de 2026; compressor C-02 ligado aos domingos sem produção.",
         "Inspeção ultrassônica trimestral, reparo de vazamentos, reduzir pressão para 7,2 bar e desligar rede fora de turno.",
         48.0, 33600, 12000, 4, "alta", "em_implementacao", date(2026, 10, 15)),
        ("OP-2026-005", "Inspeção do damper e avaliação de inversor — Ventilador 03", "rec.secador", "USE-SEC-VEN",
         "REC-SEC-VEN-03", "IDE-REC-SEC-VEN-03-FC",
         "Fator de carga do ventilador 03 próximo de 100% desde 20/07/2026.",
         "Liberar damper travado e avaliar controle de vazão por inversor nos 4 ventiladores.",
         65.0, 45500, 120000, 2, "media", "identificada", date(2026, 12, 15)),
        ("OP-2025-006", "Inversores nos elevadores da limpeza", "tor.limpeza", "USE-LIM-TRA", "TOR-LIM-ELV-01",
         "IDE-TOR-LIM-ELV-01-KWHT",
         "Elevadores operando em vazio com carga elevada.",
         "Instalar inversores com rampa e redução de velocidade em vazio.",
         11.0, 7700, 26000, 5, "baixa", "verificada", date(2025, 3, 31)),
        ("OP-2025-007", "Isolamento de dutos e recuperação de calor do secador", "rec.secador", "USE-SEC-TER",
         "REC-SEC-TRC-01", "IDE-REC-SEC-TER-MJKG",
         "Perdas térmicas em dutos sem isolamento e ar de exaustão quente descartado.",
         "Isolar dutos e recircular parte do ar de exaustão da câmara de resfriamento.",
         2600.0, 180000, 350000, 2, "alta", "implementada", date(2025, 12, 15)),
        ("OP-2026-008", "Substituir motores IE2 da linha 2 de despalha por IE4", "rec.despalha", "USE-DSP-ACI",
         "REC-DSP-MOT-02", "IDE-REC-DSP-MOT-02-KWHT",
         "Linha 2 com motores IE2 (2011) e consumo específico superior à linha 1.",
         "Substituição por motores IE4 na próxima entressafra.",
         9.0, 6300, 42000, 1, "media", "em_analise", date(2027, 1, 10)),
    ]
    by_code = {i.code: i for i in IndicatorEngine.load_indicators(db)}
    for (code, title, node, use, equip, ind_code, problem, opp, mwh, brl, inv, resp, prio, status, due) in ops:
        ind = by_code.get(ind_code)
        snapshot = None
        if ind is not None:
            ev = engine.evaluate([ind], aug)[ind.id]
            snapshot = {"period": aug.to_dict(), "value": ev.value, "unit": ind.unit.symbol, "status": ev.status,
                        "target": ev.target, "baseline": ev.baseline, "deviation_pct": ev.deviation_pct,
                        "captured_at": datetime(2026, 9, 2, 9, 0).isoformat()}
        db.add(Opportunity(code=code, title=title, node_id=nodes[node].id, use_id=uses[use].id if use else None,
                           equipment_id=equipment[equip].id if equip else None, indicator_id=ind.id if ind else None,
                           problem=problem, opportunity=opp, estimated_savings_mwh_year=mwh,
                           estimated_savings_brl_year=brl, estimated_investment_brl=inv,
                           responsible_id=people[resp].id, priority=prio, status=status, due_date=due,
                           reference_consumption=snapshot["value"] if snapshot else None,
                           reference_unit=snapshot["unit"] if snapshot else None,
                           deviation_snapshot=snapshot, notes="Registro DEMO."))
    db.commit()
    log("oportunidades")


def main():
    parser = argparse.ArgumentParser(description="Carga da base DEMO")
    parser.add_argument("--keep", action="store_true", help="não recria o schema (apenas insere)")
    args = parser.parse_args()
    from app.db import engine

    print(f"banco: {engine.url.render_as_string(hide_password=True)}")
    init_db(drop=not args.keep)
    with SessionLocal() as db:
        seed(db)
    cache.invalidate()
    print("Base DEMO criada com sucesso.")


if __name__ == "__main__":
    main()
