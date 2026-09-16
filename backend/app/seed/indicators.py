"""Definição dos IDEs da planta DEMO a partir de templates (planilha de referência USE × indicadores).

Cada indicador é *dado*: fórmula textual + vínculos de símbolos. Nenhum cálculo é hardcoded.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# código: (nome, tipo, categoria, fórmula, unidade, direção, descrição, casas, símbolos)
TEMPLATES: dict[str, tuple] = {
    "EAT": ("Energia consumida", "intrinsic", "consumo", "E", "kWh", "none",
            "Energia ativa consumida pelo equipamento no período.", 0, {"E": "energia ativa (kWh)"}),
    "FC": ("Fator de carga médio", "intrinsic", "eficiência", "(E / H) * (eta / 100) / Pn * 100", "%", "target_range",
           "Potência mecânica média estimada em relação à potência nominal, nas horas em operação.", 1,
           {"E": "energia ativa (kWh)", "H": "horas em operação (h)", "eta": "rendimento nominal (%)",
            "Pn": "potência nominal (kW)"}),
    "FP": ("Fator de potência médio", "intrinsic", "qualidade de energia", "FP", "-", "higher_better",
           "Média do fator de potência nas horas em operação.", 3, {"FP": "fator de potência"}),
    "EVZ": ("Consumo em vazio", "intrinsic", "desperdício", "EV", "kWh", "lower_better",
            "Energia consumida com o equipamento ligado sem produto.", 0, {"EV": "energia em vazio (kWh)"}),
    "IMED": ("Corrente média", "intrinsic", "operacional", "I", "A", "none",
             "Corrente média nas horas de operação (comparar com a corrente nominal).", 1, {"I": "corrente (A)"}),
    "HOP": ("Horas de funcionamento", "intrinsic", "operacional", "H", "h", "none",
            "Horas em operação no período.", 0, {"H": "horas em operação"}),
    "KWHT": ("Consumo específico", "extrinsic", "intensidade", "E / P", "kWh/t", "lower_better",
             "Energia do equipamento por tonelada processada pela etapa.", 3,
             {"E": "energia (kWh)", "P": "produção da etapa (t)"}),
    "VAZ": ("Tempo operando em vazio", "extrinsic", "desperdício", "HV / H * 100", "%", "lower_better",
            "Parcela das horas ligadas sem produto.", 1, {"HV": "horas em vazio", "H": "horas em operação"}),
    "UTIL": ("Utilização do equipamento", "extrinsic", "operacional", "H / PERIOD_HOURS * 100", "%", "none",
             "Horas ligadas sobre horas do calendário — revela regime 24×7 ou intermitente.", 1,
             {"H": "horas em operação", "PERIOD_HOURS": "horas do período"}),
    "PART": ("Partidas por dia", "extrinsic", "operacional", "N / PERIOD_DAYS", "partidas/d", "lower_better",
             "Número médio de partidas por dia (desgaste e picos de demanda).", 1,
             {"N": "nº de partidas", "PERIOD_DAYS": "dias do período"}),
    "PROD": ("Tempo produtivo sobre tempo ligado", "extrinsic", "utilização", "(H - HV) / H * 100", "%",
             "higher_better", "Parcela do tempo ligado efetivamente com produto.", 1,
             {"H": "horas em operação", "HV": "horas em vazio"}),
    "KWHL": ("Energia por lote", "extrinsic", "intensidade", "E / L", "kWh/lote", "lower_better",
             "Energia do equipamento por lote tratado.", 1, {"E": "energia (kWh)", "L": "lotes"}),
    "KWHS": ("Energia por mil sacos", "extrinsic", "intensidade", "E / S * 1000", "kWh/mil sc", "lower_better",
             "Energia por mil sacos produzidos.", 2, {"E": "energia (kWh)", "S": "sacos"}),
}


@dataclass
class BindingSpec:
    source_type: str = "variable"
    variable: str | None = None
    aggregation: str | None = None
    unit: str | None = None
    constant: float | None = None
    attribute: str | None = None
    builtin: str | None = None


@dataclass
class IndicatorSpec:
    code: str
    name: str
    kind: str
    category: str
    node: str
    formula: str
    unit: str
    direction: str
    bindings: dict[str, BindingSpec]
    description: str = ""
    use: str | None = None
    equipment: str | None = None
    template: str | None = None
    decimals: int = 2
    operating_variable: str | None = None
    # política de meta: ("pct", redução %) | ("range", min, max) | ("abs", valor) | None
    target_policy: tuple | None = ("pct", 2.0)
    status_rule: dict = field(default_factory=lambda: {"basis": "target", "tolerance_pct": 4.0, "critical_pct": 10.0})
    min_completeness: float = 80.0
    stability_band: float = 3.0
    baseline_model: str | None = None
    responsible: int | None = None
    origin_note: str | None = None
    upper_limit: float | None = None


V = lambda code, agg=None, unit=None: BindingSpec("variable", code, agg, unit)  # noqa: E731
C = lambda value: BindingSpec("constant", constant=value)  # noqa: E731
A = lambda attr: BindingSpec("equipment_attribute", attribute=attr)  # noqa: E731
B = lambda name: BindingSpec("builtin", builtin=name)  # noqa: E731


def motor_indicator(tpl: str, tag: str, equip_name: str, node: str, use: str, prod_var: str, lots_var: str,
                    sacks_var: str, responsible: int, vfd: bool = False) -> IndicatorSpec:
    name, kind, cat, formula, unit, direction, desc, dec, _ = TEMPLATES[tpl]
    binds: dict[str, BindingSpec] = {}
    op_var = None
    policy: tuple | None = ("pct", 2.0)
    rule = {"basis": "target", "tolerance_pct": 4.0, "critical_pct": 10.0}
    match tpl:
        case "EAT":
            binds = {"E": V(f"{tag}.EAT")}
            policy = None
        case "FC":
            binds = {"E": V(f"{tag}.EAT"), "H": V(f"{tag}.HOP"), "eta": A("rated_efficiency_pct"),
                     "Pn": A("rated_power_kw")}
            policy = ("range", 20.0, 90.0) if vfd else ("range", 40.0, 90.0)
            rule = {"basis": "target", "tolerance_pct": 0.0, "critical_pct": 20.0}
            op_var = f"{tag}.HOP"
        case "FP":
            binds = {"FP": V(f"{tag}.FP", "avg")}
            policy = ("abs", 0.85)  # referência no motor; a correção para 0,92 é feita no CCM
            rule = {"basis": "target", "tolerance_pct": 0.0, "critical_pct": 4.0}
            op_var = f"{tag}.HOP"
        case "EVZ":
            binds = {"EV": V(f"{tag}.EVZ")}
        case "IMED":
            binds = {"I": V(f"{tag}.IMED", "avg")}
            policy = None
            op_var = f"{tag}.HOP"
        case "HOP":
            binds = {"H": V(f"{tag}.HOP")}
            policy = None
        case "KWHT":
            binds = {"E": V(f"{tag}.EAT"), "P": V(prod_var)}
        case "VAZ":
            binds = {"HV": V(f"{tag}.HVZ"), "H": V(f"{tag}.HOP")}
            op_var = f"{tag}.HOP"
            rule = {"basis": "target", "tolerance_pct": 10.0, "critical_pct": 40.0}
        case "UTIL":
            binds = {"H": V(f"{tag}.HOP"), "PERIOD_HOURS": B("PERIOD_HOURS")}
            policy = None
        case "PART":
            binds = {"N": V(f"{tag}.NPART"), "PERIOD_DAYS": B("PERIOD_DAYS")}
            rule = {"basis": "target", "tolerance_pct": 15.0, "critical_pct": 50.0}
        case "PROD":
            binds = {"H": V(f"{tag}.HOP"), "HV": V(f"{tag}.HVZ")}
            op_var = f"{tag}.HOP"
            rule = {"basis": "target", "tolerance_pct": 2.0, "critical_pct": 8.0}
        case "KWHL":
            binds = {"E": V(f"{tag}.EAT"), "L": V(lots_var)}
        case "KWHS":
            binds = {"E": V(f"{tag}.EAT"), "S": V(sacks_var)}
    return IndicatorSpec(
        code=f"IDE-{tag}-{tpl}", name=f"{name} — {equip_name}", kind=kind, category=cat, node=node,
        formula=formula, unit=unit, direction=direction, bindings=binds, description=desc, use=use, equipment=tag,
        template=f"TPL-{tpl}", decimals=dec, operating_variable=op_var, target_policy=policy, status_rule=rule,
        responsible=responsible, stability_band=3.0 if tpl != "VAZ" else 8.0,
    )


def special_indicators() -> list[IndicatorSpec]:
    """Indicadores de processo, USE, térmicos, caldeira e ar comprimido."""
    out: list[IndicatorSpec] = []
    proc_info = [
        # nó, prefixo, nome produção, responsável
        ("rec.despalha", "REC-DSP", 1), ("rec.debulha", "REC-DEB", 1), ("rec.secador", "REC-SEC", 2),
        ("rec.caldeira", "REC-CAL", 2), ("tor.limpeza", "TOR-LIM", 3), ("tor.classificacao", "TOR-CLA", 3),
        ("tor.tratamento", "TOR-TRA", 4), ("tor.ensaque", "TOR-ENS", 4),
    ]
    for node, pre, resp in proc_info:
        prod = f"{pre}.PROD" if pre != "REC-CAL" else "REC-CAL-GER-01.VAP"
        out.append(IndicatorSpec(
            f"IDE-{pre}-INT", "Intensidade energética elétrica da etapa", "extrinsic", "intensidade", node,
            "E / P", "kWh/t", "lower_better", {"E": V(f"{pre}.EAT"), "P": V(prod)},
            "Energia do CCM da etapa por tonelada processada (inclui cargas fixas e auxiliares).",
            decimals=2, responsible=resp, baseline_model="BL-DSP-EL" if pre == "REC-DSP" else None,
        ))
        out.append(IndicatorSpec(
            f"IDE-{pre}-ESP", "Consumo sem produção", "extrinsic", "desperdício", node,
            "ESP / E * 100", "%", "lower_better", {"ESP": V(f"{pre}.ESP"), "E": V(f"{pre}.EAT")},
            "Parcela da energia consumida em horas sem produto (vazio, espera, paradas).",
            decimals=1, responsible=resp, status_rule={"basis": "target", "tolerance_pct": 5.0, "critical_pct": 20.0},
            stability_band=5.0,
        ))
        out.append(IndicatorSpec(
            f"IDE-{pre}-KWHH", "Consumo por hora produtiva", "extrinsic", "intensidade", node,
            "E / HP", "kWh/h", "none", {"E": V(f"{pre}.EAT"), "HP": V(f"{pre}.HPROD")},
            "Energia da etapa por hora efetiva de produção.", decimals=1, responsible=resp, target_policy=None,
        ))
    # ---------------- Secador (térmico)
    out += [
        IndicatorSpec(
            "IDE-REC-SEC-TER-GJT", "Consumo específico térmico do secador", "extrinsic", "intensidade", "rec.secador",
            "V * h / P", "GJ/t", "lower_better",
            {"V": V("REC-SEC-TRC-01.VAP"), "h": C(2.45), "P": V("REC-SEC.PROD")},
            "Energia térmica (vapor × entalpia útil) por tonelada de grão seco. Sensível à umidade de entrada.",
            use="USE-SEC-TER", equipment="REC-SEC-TRC-01", decimals=3, responsible=2, baseline_model="BL-SEC-TER",
        ),
        IndicatorSpec(
            "IDE-REC-SEC-TER-MJKG", "Energia por água evaporada", "extrinsic", "eficiência", "rec.secador",
            "V * h / W", "MJ/kg", "lower_better",
            {"V": V("REC-SEC-TRC-01.VAP"), "h": C(2.45), "W": V("REC-SEC.AGUA")},
            "Indicador normalizado pela água removida: separa eficiência do secador do efeito da umidade do grão.",
            use="USE-SEC-TER", equipment="REC-SEC-TRC-01", decimals=2, responsible=2, baseline_model="BL-SEC-TER",
        ),
        IndicatorSpec(
            "IDE-REC-SEC-TER-KGT", "Vapor por tonelada de grão seco", "extrinsic", "intensidade", "rec.secador",
            "V * 1000 / P", "kg/t", "lower_better", {"V": V("REC-SEC-TRC-01.VAP"), "P": V("REC-SEC.PROD")},
            "Consumo de vapor por tonelada de grão seco.", use="USE-SEC-TER", equipment="REC-SEC-TRC-01",
            decimals=0, responsible=2,
        ),
        IndicatorSpec(
            "IDE-REC-SEC-UMID", "Umidade média de entrada do grão", "extrinsic", "variável relevante", "rec.secador",
            "U", "%", "none", {"U": V("REC-SEC.UIN", "avg")},
            "Variável relevante (contexto): explica variações do consumo térmico.", decimals=1, responsible=2,
            target_policy=None, operating_variable="REC-SEC-TRC-01.HOP", min_completeness=70.0,
            origin_note="Coleta manual do laboratório (planilha).",
        ),
    ]
    # ---------------- Caldeira
    cal = dict(node="rec.caldeira", use="USE-CAL-GER", equipment="REC-CAL-GER-01", responsible=2)
    out += [
        IndicatorSpec("IDE-REC-CAL-REND", "Rendimento térmico da caldeira", "intrinsic", "eficiência",
                      formula="S * hs / (B * PCI) * 100", unit="%", direction="higher_better",
                      bindings={"S": V("REC-CAL-GER-01.VAP"), "hs": C(2.45), "B": V("REC-CAL-GER-01.BIO"),
                                "PCI": C(11.0)},
                      description="Método direto: energia útil no vapor / energia do combustível (PCI de referência).",
                      decimals=1, target_policy=("pct", 1.0),
                      status_rule={"basis": "target", "tolerance_pct": 2.0, "critical_pct": 6.0}, **cal),
        IndicatorSpec("IDE-REC-CAL-VC", "Relação vapor / combustível", "intrinsic", "eficiência",
                      formula="S / B", unit="t/t", direction="higher_better",
                      bindings={"S": V("REC-CAL-GER-01.VAP"), "B": V("REC-CAL-GER-01.BIO")},
                      description="Toneladas de vapor por tonelada de biomassa.", decimals=2,
                      target_policy=("pct", 1.0),
                      status_rule={"basis": "target", "tolerance_pct": 2.0, "critical_pct": 6.0}, **cal),
        IndicatorSpec("IDE-REC-CAL-BKG", "Biomassa por tonelada de vapor", "extrinsic", "intensidade",
                      formula="B * 1000 / S", unit="kg/t", direction="lower_better",
                      bindings={"B": V("REC-CAL-GER-01.BIO"), "S": V("REC-CAL-GER-01.VAP")},
                      description="Consumo de combustível por tonelada de vapor gerado.", decimals=0,
                      baseline_model="BL-CAL-BIO",
                      status_rule={"basis": "target", "tolerance_pct": 2.0, "critical_pct": 6.0}, **cal),
        IndicatorSpec("IDE-REC-CAL-TG", "Temperatura dos gases de exaustão", "intrinsic", "eficiência",
                      formula="TG", unit="°C", direction="lower_better",
                      bindings={"TG": V("REC-CAL-GER-01.TG", "avg")},
                      description="Temperatura elevada indica incrustação e perda pela chaminé.", decimals=0,
                      target_policy=("abs", 190.0), operating_variable="REC-CAL-GER-01.HOP",
                      status_rule={"basis": "target", "tolerance_pct": 3.0, "critical_pct": 10.0}, **cal),
        IndicatorSpec("IDE-REC-CAL-O2", "O₂ nos gases de combustão", "intrinsic", "eficiência",
                      formula="O2", unit="%", direction="target_range",
                      bindings={"O2": V("REC-CAL-GER-01.O2", "avg")},
                      description="Excesso de ar: faixa recomendada 5–7,5% (referência DEMO).", decimals=1,
                      target_policy=("range", 5.0, 7.5), operating_variable="REC-CAL-GER-01.HOP",
                      status_rule={"basis": "target", "tolerance_pct": 0.0, "critical_pct": 25.0}, **cal),
    ]
    # ---------------- Ar comprimido (USE)
    air = dict(node="tor.ensaque", use="USE-ENS-AR", responsible=4)
    out += [
        IndicatorSpec("IDE-TOR-ENS-AR-KWHNM3", "Consumo específico do ar comprimido", "intrinsic", "eficiência",
                      formula="(E1 + E2) / Q", unit="kWh/Nm³", direction="lower_better",
                      bindings={"E1": V("TOR-ENS-CMP-01.EAT"), "E2": V("TOR-ENS-CMP-02.EAT"), "Q": V("TOR-ENS.AR")},
                      description="Energia dos compressores por Nm³ entregue na rede.", decimals=3,
                      status_rule={"basis": "target", "tolerance_pct": 3.0, "critical_pct": 8.0}, **air),
        IndicatorSpec("IDE-TOR-ENS-AR-NM3SC", "Ar comprimido por saco produzido", "extrinsic", "intensidade",
                      formula="Q / S", unit="Nm³/sc", direction="lower_better",
                      bindings={"Q": V("TOR-ENS.AR"), "S": V("TOR-ENS.SACOS")},
                      description="Demanda de ar por saco — vazamentos elevam este indicador.", decimals=3,
                      baseline_model="BL-ENS-AR",
                      status_rule={"basis": "target", "tolerance_pct": 4.0, "critical_pct": 12.0}, **air),
        IndicatorSpec("IDE-TOR-ENS-AR-PRESS", "Pressão média de descarga", "intrinsic", "operacional",
                      formula="PR", unit="bar", direction="lower_better",
                      bindings={"PR": V("TOR-ENS.PRESS", "avg")},
                      description="Cada 1 bar acima do necessário ≈ +7% de energia (referência DEMO).", decimals=2,
                      target_policy=("abs", 7.3), operating_variable="TOR-ENS-CMP-01.HOP",
                      status_rule={"basis": "target", "tolerance_pct": 1.0, "critical_pct": 4.0}, **air),
        IndicatorSpec("IDE-TOR-ENS-AR-ALIVIO", "Tempo em alívio do compressor C-02", "extrinsic", "desperdício",
                      formula="HV / H * 100", unit="%", direction="lower_better",
                      bindings={"HV": V("TOR-ENS-CMP-02.HVZ"), "H": V("TOR-ENS-CMP-02.HOP")},
                      description="Horas em alívio (sem gerar ar) sobre horas ligadas.", decimals=1,
                      equipment="TOR-ENS-CMP-02", operating_variable="TOR-ENS-CMP-02.HOP",
                      status_rule={"basis": "target", "tolerance_pct": 5.0, "critical_pct": 20.0}, **air),
        IndicatorSpec("IDE-TOR-ENS-CMP-01-UTIL", "Utilização do equipamento — Compressor C-01", "extrinsic",
                      "operacional", formula="H / PERIOD_HOURS * 100", unit="%", direction="none",
                      bindings={"H": V("TOR-ENS-CMP-01.HOP"), "PERIOD_HOURS": B("PERIOD_HOURS")},
                      description="Horas ligadas sobre horas do calendário.", decimals=1, equipment="TOR-ENS-CMP-01",
                      target_policy=None, template="TPL-UTIL", **air),
        IndicatorSpec("IDE-TOR-ENS-CMP-02-PART", "Partidas por dia — Compressor C-02", "extrinsic", "operacional",
                      formula="N / PERIOD_DAYS", unit="partidas/d", direction="lower_better",
                      bindings={"N": V("TOR-ENS-CMP-02.NPART"), "PERIOD_DAYS": B("PERIOD_DAYS")},
                      description="Ciclos de partida do compressor de rotação fixa.", decimals=1,
                      equipment="TOR-ENS-CMP-02", template="TPL-PART",
                      status_rule={"basis": "target", "tolerance_pct": 15.0, "critical_pct": 50.0}, **air),
        IndicatorSpec("IDE-TOR-ENS-CMP-02-FP", "Fator de potência médio — Compressor C-02", "intrinsic",
                      "qualidade de energia", formula="FP", unit="-", direction="higher_better",
                      bindings={"FP": V("TOR-ENS-CMP-02.FP", "avg")}, description="Média nas horas em operação.",
                      decimals=3, equipment="TOR-ENS-CMP-02", template="TPL-FP", target_policy=("abs", 0.85),
                      operating_variable="TOR-ENS-CMP-02.HOP",
                      status_rule={"basis": "target", "tolerance_pct": 0.0, "critical_pct": 4.0}, **air),
        IndicatorSpec("IDE-TOR-TRA-KWHL", "Energia por lote tratado", "extrinsic", "intensidade",
                      node="tor.tratamento", formula="E / L", unit="kWh/lote", direction="lower_better",
                      bindings={"E": V("TOR-TRA.EAT"), "L": V("TOR-TRA.LOTES")},
                      description="Energia do CCM do Tratamento por lote.", decimals=1, responsible=4),
        IndicatorSpec("IDE-TOR-ENS-KWHS", "Energia por mil sacos", "extrinsic", "intensidade",
                      node="tor.ensaque", formula="E / S * 1000", unit="kWh/mil sc", direction="lower_better",
                      bindings={"E": V("TOR-ENS.EAT"), "S": V("TOR-ENS.SACOS")},
                      description="Energia do CCM do Ensaque (inclui ar comprimido) por mil sacos.", decimals=1,
                      responsible=4),
    ]
    return out


def use_indicators(uses_equipment: dict[str, list[str]], use_nodes: dict[str, str],
                   use_prod: dict[str, str], use_resp: dict[str, int], electric_uses: set[str]) -> list[IndicatorSpec]:
    """Indicadores no nível do USE: consumo específico (Σ equipamentos / produção) e participação no CCM."""
    out = []
    for use, tags in uses_equipment.items():
        if use not in electric_uses or not tags:
            continue
        symbols = {f"E{i + 1}": V(f"{t}.EAT") for i, t in enumerate(tags)}
        total = " + ".join(symbols)
        node = use_nodes[use]
        prefix_node = node.rsplit(".", 1)[0] if node.count(".") == 2 else node
        from app.seed.catalog import PROC_PREFIX

        ccm = f"{PROC_PREFIX[prefix_node]}.EAT"
        out.append(IndicatorSpec(
            f"IDE-{use}-KWHT", "Consumo específico do USE", "extrinsic", "intensidade", node,
            f"({total}) / P", "kWh/t", "lower_better", {**symbols, "P": V(use_prod[use])},
            "Soma dos equipamentos do USE por tonelada processada.", use=use, decimals=3, responsible=use_resp[use],
        ))
        out.append(IndicatorSpec(
            f"IDE-{use}-SHARE", "Participação no consumo da etapa", "extrinsic", "distribuição", node,
            f"({total}) / ET * 100", "%", "none", {**symbols, "ET": V(ccm)},
            "Parcela do CCM da etapa atribuída a este USE.", use=use, decimals=1, responsible=use_resp[use],
            target_policy=None,
        ))
    return out
