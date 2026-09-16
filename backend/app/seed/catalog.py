"""Catálogo da planta DEMO (dados fictícios — NÃO representam instalações reais da Bayer).

Tudo aqui é *dado* inserido em tabelas configuráveis; a aplicação não conhece estes nomes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

DATA_START = date(2023, 9, 1)
DATA_END = date(2026, 9, 14)

LEVELS = [
    ("company", "Empresa", 0, False, False),
    ("plant", "Planta", 1, False, False),
    ("area", "Área", 2, True, False),
    ("process", "Processo", 3, True, True),
    ("subprocess", "Subprocesso", 4, False, True),
]

UNITS = [
    # símbolo, nome, grandeza, fator p/ base
    ("kWh", "quilowatt-hora", "energy", 1.0),
    ("MWh", "megawatt-hora", "energy", 1000.0),
    ("GJ", "gigajoule", "energy", 277.7777778),
    ("MJ", "megajoule", "energy", 0.2777777778),
    ("kg", "quilograma", "mass", 1.0),
    ("t", "tonelada", "mass", 1000.0),
    ("h", "hora", "time", 1.0),
    ("d", "dia", "time", 24.0),
    ("kW", "quilowatt", "power", 1.0),
    ("Nm³", "normal metro cúbico", "gas_volume", 1.0),
    ("%", "percentual", "ratio", 0.01),
    ("-", "adimensional", "ratio", 1.0),
    ("A", "ampère", "current", 1.0),
    ("V", "volt", "voltage", 1.0),
    ("°C", "grau Celsius", "temperature", 1.0),
    ("bar", "bar", "pressure", 1.0),
    ("un", "unidade", "count", 1.0),
    ("sc", "saco", "count", 1.0),
    ("lote", "lote", "count", 1.0),
    ("partidas", "partidas", "count", 1.0),
    ("kWh/t", "kWh por tonelada", "specific_energy", 1.0),
    ("MWh/t", "MWh por tonelada", "specific_energy", 1000.0),
    ("GJ/t", "GJ por tonelada", "specific_energy", 277.7777778),
    ("MJ/kg", "MJ por kg", "specific_energy", 277.7777778),
    ("kg/t", "kg por tonelada", "mass_ratio", 0.001),
    ("t/t", "tonelada por tonelada", "mass_ratio", 1.0),
    ("kWh/Nm³", "kWh por Nm³", "specific_energy_volume", 1.0),
    ("Nm³/sc", "Nm³ por saco", "volume_per_count", 1.0),
    ("h/t", "horas por tonelada", "time_per_mass", 1.0),
    ("kWh/lote", "kWh por lote", "energy_per_count", 1.0),
    ("kWh/mil sc", "kWh por mil sacos", "energy_per_count", 0.001),
    ("kWh/h", "kWh por hora produtiva", "power", 1.0),
    ("partidas/d", "partidas por dia", "frequency", 1.0),
]

CARRIERS = [
    # code, nome, tipo, unidade, kWh por unidade, slot
    ("eletricidade", "Energia elétrica", "boundary", "kWh", 1.0, 1,
     "Energia comprada da concessionária (medição de fronteira + medidores dos CCMs)."),
    ("biomassa", "Biomassa (cavaco + sabugo)", "boundary", "t", 11.0 * 277.7777778, 2,
     "PCI médio de referência 11 GJ/t (DEMO). Sabugo da Debulha complementa o cavaco."),
    ("vapor", "Vapor saturado 10 bar", "internal", "t", 2.45 * 277.7777778, 3,
     "Energia secundária gerada na Caldeira. Entalpia útil de referência 2,45 GJ/t (DEMO)."),
    ("ar_comprimido", "Ar comprimido 7 bar", "internal", "Nm³", 0.11, 4,
     "Utilidade gerada internamente pelos compressores (equivalente elétrico de referência)."),
]

USE_CATEGORIES = [
    ("acionamentos", "Acionamentos de processo", "cog", 1, "Motores elétricos de máquinas de processo."),
    ("ventilacao", "Ventilação e exaustão", "fan", 2, "Ventiladores de secagem, exaustores, tiragem."),
    ("transporte", "Transporte de grãos", "move-vertical", 3, "Elevadores de canecas, esteiras, roscas."),
    ("termico", "Sistemas térmicos / secagem", "thermometer", 4, "Aquecimento de ar de secagem."),
    ("caldeira", "Geração de vapor", "flame", 5, "Caldeiras e combustão."),
    ("ar_comprimido", "Ar comprimido", "gauge", 6, "Compressores e rede de ar."),
    ("bombeamento", "Bombeamento", "droplets", 7, "Bombas de água, calda e condensado."),
    ("outros", "Outros usos", "box", 8, "Demais cargas cadastradas como USE."),
]

DATA_SOURCES = [
    ("HIST", "Historiador de processo (DEMO)", "historian", "OPC UA → gateway de borda", True,
     "Tags de processo e estados operacionais consolidados em base diária."),
    ("MED", "Medidores de energia dos CCMs (DEMO)", "meter", "Modbus TCP via gateway", True,
     "Multimedidores de energia por alimentador."),
    ("MES", "MES — apontamento de produção (DEMO)", "mes", "REST API", True, "Toneladas, lotes e sacos."),
    ("LAB", "Laboratório de umidade (DEMO)", "manual", "Planilha / CSV", False, "Coleta manual por turno."),
    ("CALC", "Calculado — balanço de massa (DEMO)", "calculated", "Motor de cálculo", True,
     "Água removida = massa úmida × (Ui − Uf)/(100 − Uf)."),
]

PEOPLE = [
    ("Ana Ribeiro (DEMO)", "Coordenação de Gestão de Energia", "ana.ribeiro@demo.local"),
    ("Carlos Menezes (DEMO)", "Dono do processo — Despalha e Debulha", "carlos.menezes@demo.local"),
    ("Juliana Prado (DEMO)", "Dona do processo — Secagem e Caldeira", "juliana.prado@demo.local"),
    ("Rafael Tavares (DEMO)", "Dono do processo — Limpeza e Classificação", "rafael.tavares@demo.local"),
    ("Marina Lopes (DEMO)", "Dona do processo — Tratamento e Ensaque", "marina.lopes@demo.local"),
    ("Eduardo Nunes (DEMO)", "Manutenção elétrica", "eduardo.nunes@demo.local"),
]

# código, nome, nível, pai, ordem, dono(idx PEOPLE), cor, regime, descrição
NODES = [
    ("bayer", "Bayer", "company", None, 0, 0, None, None, "Empresa"),
    ("planta-demo", "Planta DEMO — Beneficiamento de Sementes", "plant", "bayer", 0, 0, None, None,
     "Planta fictícia para demonstração da metodologia (MOCK DATA)."),
    ("recebimento", "Recebimento", "area", "planta-demo", 1, 1, 1, "sazonal",
     "Recepção de espigas, despalha, debulha, secagem e geração de vapor."),
    ("torre", "Torre", "area", "planta-demo", 2, 3, 2, "campanhas",
     "Beneficiamento das sementes secas: limpeza, classificação, tratamento e ensaque."),
    ("rec.despalha", "Despalha", "process", "recebimento", 1, 1, None, "sazonal — safra",
     "Remoção da palha das espigas recebidas."),
    ("rec.debulha", "Debulha", "process", "recebimento", 2, 1, None, "sazonal — safra",
     "Separação dos grãos do sabugo."),
    ("rec.secador", "Secador", "process", "recebimento", 3, 2, None, "contínuo 24 h durante a safra",
     "Secagem dos grãos úmidos com ar aquecido por vapor."),
    ("rec.caldeira", "Caldeira", "process", "recebimento", 4, 2, None, "contínuo 24 h durante a safra",
     "Geração de vapor a partir de biomassa para o secador."),
    ("tor.limpeza", "Limpeza", "process", "torre", 1, 3, None, "3 turnos, seg–sáb",
     "Pré-limpeza e limpeza com máquinas de ar e peneiras."),
    ("tor.classificacao", "Classificação", "process", "torre", 2, 3, None, "3 turnos, seg–sáb",
     "Classificação por tamanho e densidade."),
    ("tor.tratamento", "Tratamento", "process", "torre", 3, 4, None, "campanha de tratamento",
     "Tratamento industrial de sementes."),
    ("tor.ensaque", "Ensaque", "process", "torre", 4, 4, None, "campanha de ensaque",
     "Ensacamento, paletização e utilidades (ar comprimido)."),
    ("tor.tratamento.calda", "Preparo de calda", "subprocess", "tor.tratamento", 1, 4, None, "por lote",
     "Preparo e dosagem da calda de tratamento."),
    ("tor.tratamento.aplicacao", "Aplicação", "subprocess", "tor.tratamento", 2, 4, None, "por lote",
     "Aplicação da calda nos tratadores de sementes."),
    ("tor.ensaque.ensacamento", "Ensacamento", "subprocess", "tor.ensaque", 1, 4, None, "campanha",
     "Ensacadeiras e transporte de sacaria."),
    ("tor.ensaque.paletizacao", "Paletização", "subprocess", "tor.ensaque", 2, 4, None, "campanha",
     "Formação de paletes para expedição."),
]

# Prefixo de tags por processo.
PROC_PREFIX = {
    "rec.despalha": "REC-DSP",
    "rec.debulha": "REC-DEB",
    "rec.secador": "REC-SEC",
    "rec.caldeira": "REC-CAL",
    "tor.limpeza": "TOR-LIM",
    "tor.classificacao": "TOR-CLA",
    "tor.tratamento": "TOR-TRA",
    "tor.ensaque": "TOR-ENS",
}

# code, nome, categoria, nó, fonte, regime, período de operação, responsável(idx), motivo de significância
USES = [
    ("USE-DSP-ACI", "Acionamento dos despalhadores", "acionamentos", "rec.despalha", "eletricidade",
     "seasonal", "Safra verão (jan–jun) e safrinha (jun–set)", 1, "Maior carga elétrica da Despalha."),
    ("USE-DSP-TRA", "Transporte de espigas", "transporte", "rec.despalha", "eletricidade",
     "intermittent", "Durante alimentação de espigas", 1, "Operação intermitente com potencial de desligamento."),
    ("USE-DSP-EXA", "Exaustão de palha", "ventilacao", "rec.despalha", "eletricidade",
     "intermittent", "Durante despalha", 1, "Ventilador de grande porte sem inversor."),
    ("USE-DEB-ACI", "Acionamento dos debulhadores", "acionamentos", "rec.debulha", "eletricidade",
     "intermittent", "Safra; alimentação em bateladas", 1, "Tempo em vazio relevante entre cargas."),
    ("USE-DEB-TRA", "Transporte de grãos e sabugo", "transporte", "rec.debulha", "eletricidade",
     "intermittent", "Durante debulha", 1, "Elevadores e roscas."),
    ("USE-SEC-VEN", "Sistema de ventilação do secador", "ventilacao", "rec.secador", "eletricidade",
     "continuous_24x7", "24 h/dia durante a safra", 2, "Maior USE elétrico da planta."),
    ("USE-SEC-TER", "Aquecimento do ar de secagem (vapor)", "termico", "rec.secador", "vapor",
     "continuous_24x7", "24 h/dia durante a safra", 2, "Maior demanda térmica — depende da umidade do grão."),
    ("USE-SEC-TRA", "Movimentação de grãos do secador", "transporte", "rec.secador", "eletricidade",
     "intermittent", "Carga e descarga das câmaras", 2, "Elevadores de grande altura."),
    ("USE-CAL-GER", "Geração de vapor — caldeira a biomassa", "caldeira", "rec.caldeira", "biomassa",
     "continuous_24x7", "24 h/dia durante a safra", 2, "Principal consumo de energia primária da planta."),
    ("USE-CAL-VEN", "Ventiladores da caldeira", "ventilacao", "rec.caldeira", "eletricidade",
     "continuous_24x7", "24 h/dia durante a safra", 2, "Tiragem induzida e ar forçado."),
    ("USE-CAL-BOM", "Bombeamento de água de alimentação", "bombeamento", "rec.caldeira", "eletricidade",
     "continuous_24x7", "24 h/dia durante a safra", 2, "Bomba de alta pressão."),
    ("USE-LIM-ACI", "Máquinas de ar e peneiras", "acionamentos", "tor.limpeza", "eletricidade",
     "intermittent", "3 turnos, seg–sáb", 3, "Operação contínua na campanha."),
    ("USE-LIM-ASP", "Aspiração com filtro de mangas", "ventilacao", "tor.limpeza", "eletricidade",
     "intermittent", "3 turnos, seg–sáb", 3, "Carga sensível à perda de carga do filtro."),
    ("USE-LIM-TRA", "Elevadores da limpeza", "transporte", "tor.limpeza", "eletricidade",
     "intermittent", "3 turnos, seg–sáb", 3, "Inversor instalado em mar/2025 (DEMO)."),
    ("USE-CLA-ACI", "Classificadores e mesas densimétricas", "acionamentos", "tor.classificacao", "eletricidade",
     "intermittent", "3 turnos, seg–sáb", 3, "Conjunto de máquinas de classificação."),
    ("USE-CLA-TRA", "Transporte da classificação", "transporte", "tor.classificacao", "eletricidade",
     "intermittent", "3 turnos, seg–sáb", 3, "Elevadores de canecas."),
    ("USE-TRA-CAL", "Preparo e dosagem de calda", "bombeamento", "tor.tratamento.calda", "eletricidade",
     "batch", "Por lote de tratamento", 4, "Agitadores e bombas dosadoras."),
    ("USE-TRA-APL", "Tratadores de sementes", "acionamentos", "tor.tratamento.aplicacao", "eletricidade",
     "batch", "Por lote de tratamento", 4, "Tratadores com atomizador."),
    ("USE-ENS-ENS", "Ensacadeiras e transportadores", "acionamentos", "tor.ensaque.ensacamento", "eletricidade",
     "intermittent", "Campanha de ensaque", 4, "Linha de ensaque."),
    ("USE-ENS-PAL", "Paletização", "acionamentos", "tor.ensaque.paletizacao", "eletricidade",
     "intermittent", "Campanha de ensaque", 4, "Paletizador robótico."),
    ("USE-ENS-AR", "Sistema de ar comprimido", "ar_comprimido", "tor.ensaque", "eletricidade",
     "continuous_24x7", "Enquanto houver operação na Torre (e vazamentos fora dela)", 4,
     "Atende ensacadeiras, paletizador e filtro de mangas — vazamentos elevam o consumo sem produção."),
]


@dataclass
class MotorSpec:
    tag: str
    name: str
    use: str
    proc: str  # processo que dita horas/utilização/produção
    equipment_type: str
    pn: float
    eta: float
    eff_class: str
    vfd: bool = False
    year: int = 2018
    manufacturer: str = "Fabricante DEMO"
    lf_load: float = 0.75
    lf_idle: float = 0.35
    idle: float = 0.06
    hours_mult: float = 1.0
    pf: float = 0.86
    starts: float = 2.0
    voltage: float = 380.0
    # indicadores a instanciar (códigos de template)
    indicators: list[str] = field(default_factory=lambda: ["FC", "EAT", "KWHT", "VAZ"])


BASIC = ["EAT", "FC", "FP", "KWHT", "VAZ"]

MOTORS: list[MotorSpec] = [
    # --- Despalha
    MotorSpec("REC-DSP-MOT-01", "Despalhadores — linha 1", "USE-DSP-ACI", "rec.despalha",
              "Conjunto de motores de indução trifásicos", 90, 94.5, "IE3", year=2019, lf_load=0.72, idle=0.07,
              indicators=BASIC + ["EVZ"]),
    MotorSpec("REC-DSP-MOT-02", "Despalhadores — linha 2", "USE-DSP-ACI", "rec.despalha",
              "Conjunto de motores de indução trifásicos", 90, 92.6, "IE2", year=2011, lf_load=0.74, idle=0.08,
              pf=0.83, indicators=BASIC + ["EVZ"]),
    MotorSpec("REC-DSP-ELV-01", "Elevador de canecas EL-01", "USE-DSP-TRA", "rec.despalha",
              "Motorredutor", 30, 93.0, "IE3", year=2016, lf_load=0.68, idle=0.10, indicators=BASIC + ["EVZ"]),
    MotorSpec("REC-DSP-TRP-01", "Esteiras de espigas (conjunto)", "USE-DSP-TRA", "rec.despalha",
              "Motorredutores", 22, 91.5, "IE2", year=2014, lf_load=0.60, idle=0.12,
              indicators=["EAT", "FC", "KWHT", "VAZ"]),
    MotorSpec("REC-DSP-EXA-01", "Exaustor de palha", "USE-DSP-EXA", "rec.despalha",
              "Ventilador centrífugo", 45, 93.6, "IE3", year=2017, lf_load=0.80, idle=0.09, pf=0.85,
              indicators=BASIC + ["EVZ"]),
    # --- Debulha
    MotorSpec("REC-DEB-MOT-01", "Debulhador 01", "USE-DEB-ACI", "rec.debulha", "Motor de indução trifásico",
              55, 94.1, "IE3", year=2018, lf_load=0.76, idle=0.07, starts=4.0,
              indicators=BASIC + ["EVZ", "PART"]),
    MotorSpec("REC-DEB-MOT-02", "Debulhador 02", "USE-DEB-ACI", "rec.debulha", "Motor de indução trifásico",
              55, 94.1, "IE3", year=2018, lf_load=0.75, idle=0.07, starts=4.0,
              indicators=BASIC + ["EVZ", "PART", "PROD"]),
    MotorSpec("REC-DEB-ELV-01", "Elevador de canecas EL-02", "USE-DEB-TRA", "rec.debulha", "Motorredutor",
              22, 92.6, "IE3", year=2016, lf_load=0.66, idle=0.10, indicators=["EAT", "FC", "KWHT", "VAZ"]),
    MotorSpec("REC-DEB-TRP-01", "Rosca transportadora de sabugo", "USE-DEB-TRA", "rec.debulha", "Motorredutor",
              15, 91.0, "IE2", year=2013, lf_load=0.62, idle=0.11, indicators=["EAT", "FC", "KWHT", "VAZ"]),
    # --- Secador
    *[
        MotorSpec(f"REC-SEC-VEN-0{i}", f"Motor ventilador 0{i}", "USE-SEC-VEN", "rec.secador",
                  "Motor de indução — ventilador axial", 75, 95.0 if i != 4 else 93.6, "IE3" if i != 4 else "IE2",
                  year=2015 if i != 4 else 2009, lf_load=0.80, idle=0.02, hours_mult=1.0, pf=0.87, starts=0.4,
                  indicators=BASIC + ["IMED", "HOP", "UTIL"])
        for i in (1, 2, 3, 4)
    ],
    MotorSpec("REC-SEC-ELV-01", "Elevadores de carga/descarga", "USE-SEC-TRA", "rec.secador",
              "Motorredutores", 37, 93.9, "IE3", year=2015, lf_load=0.70, idle=0.12, hours_mult=0.75,
              indicators=BASIC + ["EVZ"]),
    # --- Caldeira
    MotorSpec("REC-CAL-VID-01", "Ventilador de tiragem induzida", "USE-CAL-VEN", "rec.caldeira",
              "Ventilador centrífugo com inversor", 90, 95.0, "IE3", vfd=True, year=2019, lf_load=0.60,
              idle=0.03, pf=0.95, starts=0.5, indicators=BASIC + ["HOP", "UTIL"]),
    MotorSpec("REC-CAL-VAF-01", "Ventilador de ar forçado", "USE-CAL-VEN", "rec.caldeira",
              "Ventilador centrífugo", 45, 93.6, "IE3", year=2019, lf_load=0.72, idle=0.03, pf=0.86, starts=0.5,
              indicators=BASIC),
    MotorSpec("REC-CAL-BOM-01", "Bomba de alimentação B-01", "USE-CAL-BOM", "rec.caldeira",
              "Bomba centrífuga multiestágio", 22, 92.6, "IE3", year=2019, lf_load=0.78, idle=0.05, starts=3.0,
              indicators=BASIC),
    # --- Limpeza
    MotorSpec("TOR-LIM-MAP-01", "Máquina de ar e peneiras MAP-01", "USE-LIM-ACI", "tor.limpeza",
              "Motor de indução + ventilador", 15, 92.1, "IE3", year=2020, lf_load=0.70, idle=0.06,
              indicators=["EAT", "FC", "KWHT", "VAZ"]),
    MotorSpec("TOR-LIM-MAP-02", "Máquina de ar e peneiras MAP-02", "USE-LIM-ACI", "tor.limpeza",
              "Motor de indução + ventilador", 15, 92.1, "IE3", year=2020, lf_load=0.70, idle=0.06,
              indicators=["EAT", "FC", "KWHT", "VAZ"]),
    MotorSpec("TOR-LIM-ASP-01", "Exaustor do filtro de mangas", "USE-LIM-ASP", "tor.limpeza",
              "Ventilador centrífugo", 55, 94.1, "IE3", year=2017, lf_load=0.70, idle=0.05, pf=0.86,
              indicators=BASIC + ["IMED"]),
    MotorSpec("TOR-LIM-ELV-01", "Elevadores de canecas EL-10/11", "USE-LIM-TRA", "tor.limpeza",
              "Motorredutores (inversor desde mar/2025)", 30, 93.0, "IE3", vfd=True, year=2016, lf_load=0.66,
              idle=0.16, indicators=BASIC + ["EVZ"]),
    # --- Classificação
    MotorSpec("TOR-CLA-PEN-01", "Classificadores cilíndricos (conjunto)", "USE-CLA-ACI", "tor.classificacao",
              "Motorredutores", 22, 91.5, "IE2", year=2014, lf_load=0.65, idle=0.06,
              indicators=["EAT", "FC", "KWHT", "VAZ"]),
    MotorSpec("TOR-CLA-MDS-01", "Mesas densimétricas (conjunto)", "USE-CLA-ACI", "tor.classificacao",
              "Motores de vibração + ventiladores", 44, 92.8, "IE3", year=2018, lf_load=0.74, idle=0.05,
              indicators=BASIC),
    MotorSpec("TOR-CLA-ELV-01", "Elevadores de canecas EL-20/21/22", "USE-CLA-TRA", "tor.classificacao",
              "Motorredutores", 33, 92.6, "IE3", year=2016, lf_load=0.64, idle=0.10,
              indicators=BASIC + ["EVZ"]),
    # --- Tratamento
    MotorSpec("TOR-TRA-AGT-01", "Agitadores dos tanques de calda", "USE-TRA-CAL", "tor.tratamento",
              "Motorredutores", 11, 90.4, "IE3", year=2021, lf_load=0.55, idle=0.20, hours_mult=0.8,
              indicators=["EAT", "FC", "KWHL", "VAZ"]),
    MotorSpec("TOR-TRA-BOM-01", "Bombas dosadoras (conjunto)", "USE-TRA-CAL", "tor.tratamento",
              "Bombas de deslocamento positivo", 6.6, 88.0, "IE3", year=2021, lf_load=0.60, idle=0.15,
              hours_mult=0.8, indicators=["EAT", "KWHL"]),
    MotorSpec("TOR-TRA-TRT-01", "Tratador de sementes TS-01", "USE-TRA-APL", "tor.tratamento",
              "Tratador com atomizador", 15, 91.0, "IE3", year=2021, lf_load=0.72, idle=0.10,
              indicators=["EAT", "FC", "KWHT", "KWHL", "VAZ"]),
    MotorSpec("TOR-TRA-TRT-02", "Tratador de sementes TS-02", "USE-TRA-APL", "tor.tratamento",
              "Tratador com atomizador", 15, 91.0, "IE3", year=2022, lf_load=0.72, idle=0.10,
              indicators=["EAT", "FC", "KWHT", "KWHL", "VAZ"]),
    # --- Ensaque
    MotorSpec("TOR-ENS-ENS-01", "Ensacadeiras automáticas (conjunto)", "USE-ENS-ENS", "tor.ensaque",
              "Ensacadeiras pneumáticas", 16.5, 90.0, "IE3", year=2020, lf_load=0.62, idle=0.12,
              indicators=["EAT", "FC", "KWHS", "VAZ"]),
    MotorSpec("TOR-ENS-TRP-01", "Esteiras de sacaria", "USE-ENS-ENS", "tor.ensaque", "Motorredutores",
              12, 89.5, "IE2", year=2015, lf_load=0.58, idle=0.15, indicators=["EAT", "FC", "KWHS", "VAZ"]),
    MotorSpec("TOR-ENS-PAL-01", "Paletizador robótico", "USE-ENS-PAL", "tor.ensaque", "Robô articulado",
              15, 92.0, "IE3", year=2022, lf_load=0.45, idle=0.18, indicators=["EAT", "KWHS", "VAZ"]),
]

# Equipamentos especiais (não-motores ou com modelo próprio)
SPECIAL_EQUIPMENT = [
    # tag, nome, use, tipo, potência, eficiência, classe, vfd, ano, atributos
    ("REC-SEC-TRC-01", "Baterias de troca térmica a vapor", "USE-SEC-TER", "Trocadores de calor vapor-ar",
     None, None, None, False, 2015, {"area_troca_m2": 820, "pressao_vapor_bar": 10}),
    ("REC-CAL-GER-01", "Caldeira de biomassa CB-01 (20 t/h)", "USE-CAL-GER", "Caldeira aquatubular a biomassa",
     None, 80.0, None, False, 2019,
     {"capacidade_t_h": 20, "pressao_bar": 10, "combustivel": "cavaco + sabugo", "rendimento_projeto_pct": 82}),
    ("TOR-ENS-CMP-01", "Compressor parafuso C-01 (VSD)", "USE-ENS-AR", "Compressor parafuso com inversor",
     75, 95.0, "IE4", True, 2021, {"vazao_nm3_min": 12.5, "pressao_bar": 7.5}),
    ("TOR-ENS-CMP-02", "Compressor parafuso C-02 (rotação fixa)", "USE-ENS-AR", "Compressor parafuso carga/alívio",
     75, 94.5, "IE3", False, 2012, {"vazao_nm3_min": 12.0, "pressao_bar": 7.5}),
]

CROP_YEARS = [
    ("CY2024", "Crop Year 2024", date(2023, 9, 1), date(2024, 8, 31)),
    ("CY2025", "Crop Year 2025", date(2024, 9, 1), date(2025, 8, 31)),
    ("CY2026", "Crop Year 2026", date(2025, 9, 1), date(2026, 8, 31)),
    ("CY2027", "Crop Year 2027", date(2026, 9, 1), date(2027, 8, 31)),
]

SEASONS = [
    ("SV2024", "Safra Verão 2024", "verao", "CY2024", date(2024, 1, 15), date(2024, 6, 10)),
    ("SF2024", "Safrinha 2024", "safrinha", "CY2024", date(2024, 6, 11), date(2024, 9, 15)),
    ("SV2025", "Safra Verão 2025", "verao", "CY2025", date(2025, 1, 15), date(2025, 6, 10)),
    ("SF2025", "Safrinha 2025", "safrinha", "CY2025", date(2025, 6, 11), date(2025, 9, 15)),
    ("SV2026", "Safra Verão 2026", "verao", "CY2026", date(2026, 1, 15), date(2026, 6, 10)),
    ("SF2026", "Safrinha 2026", "safrinha", "CY2026", date(2026, 6, 11), date(2026, 9, 15)),
]

PRODUCTS = [
    ("HM-2201", "Híbrido HM-2201 (DEMO)"),
    ("HM-3150", "Híbrido HM-3150 (DEMO)"),
    ("HM-4480", "Híbrido HM-4480 (DEMO)"),
]

USERS = [
    ("admin", "Administrador (DEMO)", "admin", None, []),
    ("energia", "Ana Ribeiro — Gestão de Energia (DEMO)", "energy_manager", 0, []),
    ("dono.recebimento", "Carlos Menezes — Dono do Processo (DEMO)", "process_owner", 1, ["recebimento"]),
    ("dono.torre", "Marina Lopes — Dona do Processo (DEMO)", "process_owner", 4, ["torre"]),
    ("visualizador", "Visualizador (DEMO)", "viewer", None, []),
]
