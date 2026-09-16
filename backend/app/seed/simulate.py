"""Simulação diária da planta DEMO (MOCK DATA).

Modelo físico simplificado, suficiente para produzir dados coerentes entre si:
- Recebimento sazonal (safra verão e safrinha) com chuva, domingos e crescimento de volume por ano;
- balanço de massa (espigas → grãos úmidos → grãos secos) e água removida no secador;
- vapor = perdas fixas + água evaporada × energia específica (piora com frio, melhora após retrofit);
- caldeira com incrustação progressiva, limpezas periódicas e excesso de ar;
- Torre alimentada por estoque de grão seco (limpeza/classificação) e de semente classificada (tratamento/ensaque);
- motores: horas, tempo em vazio, fator de carga, fator de potência, corrente e partidas;
- ar comprimido com vazamentos crescentes, pressão elevada e compressor de rotação fixa em alívio.

Histórias embutidas para demonstrar as análises (todas fictícias):
  1. Debulhador 02 passa a operar mais tempo em vazio a partir de jan/2026.
  2. Retrofit térmico do secador em dez/2025 (−9% de energia por água evaporada).
  3. Safra Verão 2026 com grão mais úmido: vapor absoluto sobe, eficiência melhora.
  4. Caldeira sem limpeza programada na Safrinha 2026 + excesso de ar: rendimento cai.
  5. Ventilador 03 do secador com damper travado desde 20/07/2026.
  6. Inversor nos elevadores da limpeza em 10/03/2025 (melhoria ano × ano).
  7. Filtro de mangas colmatando desde jul/2026 (exaustor com mais carga).
  8. Vazamentos de ar comprimido crescentes em 2026.
  9. Falha de comunicação do medidor das mesas densimétricas (10–21/08/2026).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np

from app.seed.catalog import DATA_END, DATA_START, MOTORS, PROC_PREFIX

N = (DATA_END - DATA_START).days + 1
DAYS = [DATA_START + timedelta(days=i) for i in range(N)]
IDX = {d: i for i, d in enumerate(DAYS)}

CAP_RATE = {  # t/h de referência para utilização
    "rec.despalha": 40, "rec.debulha": 35, "rec.secador": 26, "rec.caldeira": 20,
    "tor.limpeza": 25, "tor.classificacao": 24, "tor.tratamento": 20, "tor.ensaque": 20,
}
AUX_SHARE = {  # cargas não submedidas no CCM (iluminação, pequenos motores, automação)
    "rec.despalha": 0.09, "rec.debulha": 0.08, "rec.secador": 0.05, "rec.caldeira": 0.07,
    "tor.limpeza": 0.10, "tor.classificacao": 0.12, "tor.tratamento": 0.15, "tor.ensaque": 0.08,
}
BASE_KWH = {
    "rec.despalha": 45, "rec.debulha": 40, "rec.secador": 60, "rec.caldeira": 55,
    "tor.limpeza": 50, "tor.classificacao": 45, "tor.tratamento": 70, "tor.ensaque": 60,
}


@dataclass
class Event:
    node: str | None
    equipment: str | None
    event_type: str
    start: date
    end: date | None
    description: str


@dataclass
class SimResult:
    values: dict[str, np.ndarray] = field(default_factory=dict)
    quality: dict[str, dict[int, str]] = field(default_factory=dict)
    events: list[Event] = field(default_factory=list)
    lots: list[tuple[date, int, float]] = field(default_factory=list)  # (dia, nº lotes, t)


def _ramp(d: date, start: date, end: date) -> float:
    if d <= start:
        return 0.0
    if d >= end:
        return 1.0
    return (d - start).days / (end - start).days


class PlantSimulator:
    def __init__(self, seed: int = 20260915):
        self.rng = np.random.default_rng(seed)
        self.r = SimResult()
        self.ctx: dict[str, dict[str, np.ndarray]] = {}

    # ------------------------------------------------------------------ utilidades
    def _arr(self, code: str) -> np.ndarray:
        if code not in self.r.values:
            self.r.values[code] = np.full(N, np.nan)
        return self.r.values[code]

    def _ln(self, sigma: float) -> float:
        return float(self.rng.lognormal(0.0, sigma))

    # ------------------------------------------------------------------ recebimento
    def simulate_receiving(self):
        rng = self.rng
        vol = {2023: 0.97, 2024: 1.0, 2025: 1.07, 2026: 1.12}
        windows = []
        for y in (2023, 2024, 2025, 2026):
            j1, j2 = (int(x) for x in rng.integers(-6, 7, size=2))
            windows.append(("verao", y, date(y, 1, 20) + timedelta(days=j1), date(y, 5, 31) + timedelta(days=j1), 1.0))
            windows.append(("safrinha", y, date(y, 6, 12) + timedelta(days=j2), date(y, 9, 6) + timedelta(days=j2), 0.5))
        moist_base = {("verao", 2024): 30.0, ("verao", 2025): 29.5, ("verao", 2026): 33.0,
                      ("safrinha", 2023): 24.5, ("safrinha", 2024): 25.0, ("safrinha", 2025): 25.5,
                      ("safrinha", 2026): 26.0, ("verao", 2023): 30.0}

        P = np.zeros(N); H = np.zeros(N); UIN = np.full(N, np.nan); UOUT = np.full(N, np.nan)
        TAMB = np.zeros(N)
        for i, d in enumerate(DAYS):
            doy = d.timetuple().tm_yday
            TAMB[i] = 23 + 2.8 * math.cos(2 * math.pi * (doy - 20) / 365.25) + rng.normal(0, 1.5)
            shape, win = 0.0, None
            for kind, y, s, e, amp in windows:
                if s <= d <= e:
                    x = (d - s).days / (e - s).days
                    val = amp * math.sin(math.pi * x) ** 0.7
                    if val > shape:
                        shape, win = val, (kind, y, x)
            if shape <= 0:
                continue
            p = 880 * vol[d.year] * shape
            if d.weekday() == 6:
                p *= 0.72
            if rng.random() < 0.08:
                p *= rng.uniform(0.25, 0.6)
            p *= self._ln(0.08)
            if p < 60:
                continue
            P[i] = p
            H[i] = float(np.clip(12 + 12 * min(1.0, p / 600) + rng.normal(0, 1.0), 8, 24))
            kind, y, x = win
            UIN[i] = moist_base.get((kind, y), 28.0) + 2.0 * (1 - 2 * x) + rng.normal(0, 1.0)
            UOUT[i] = 12.5 + rng.normal(0, 0.25)

        wet = 0.86 * 0.78 * P
        with np.errstate(invalid="ignore"):
            dry = np.where(P > 0, wet * (100 - np.nan_to_num(UIN)) / (100 - np.nan_to_num(UOUT, nan=12.5)), 0.0)
        water = np.where(P > 0, wet - dry, 0.0)
        h_sec = np.where(P > 250, 24.0, np.where(P > 0, np.minimum(24.0, H + 4), 0.0))

        # vapor do secador
        V = np.zeros(N)
        for i, d in enumerate(DAYS):
            if P[i] <= 0:
                continue
            q = 4.6 * (0.91 if d >= date(2025, 12, 15) else 1.0) * (1 + 0.006 * (22 - TAMB[i])) * self._ln(0.03)
            V[i] = 0.45 * h_sec[i] + water[i] * q / 2.45

        # caldeira: incrustação e limpezas
        cleanings = []
        for y in (2024, 2025, 2026):
            cleanings += [date(y, 1, 12), date(y, 4, 12)]
            if y != 2026:
                cleanings.append(date(y, 6, 9))
        cleanings.append(date(2023, 6, 9))
        S = V * 1.04
        ETA = np.full(N, np.nan); O2 = np.full(N, np.nan); TG = np.full(N, np.nan); BIO = np.zeros(N)
        k = 60
        for i, d in enumerate(DAYS):
            if d in cleanings:
                k = 0
            if S[i] <= 0:
                continue
            k += 1
            o2 = rng.normal(7.9, 0.5) if d >= date(2026, 6, 1) else rng.normal(6.5, 0.45)
            eta = 0.805 - 0.00045 * k - 0.004 * max(0.0, o2 - 6.5) + rng.normal(0, 0.006)
            ETA[i], O2[i] = eta, o2
            TG[i] = 170 + 0.30 * k + 3.0 * max(0.0, o2 - 6.5) + rng.normal(0, 4)
            BIO[i] = S[i] * 2.45 / (eta * 11.0 * self._ln(0.035))
        for c in cleanings:
            if DATA_START <= c <= DATA_END:
                self.r.events.append(Event("rec.caldeira", "REC-CAL-GER-01", "manutencao", c, c + timedelta(days=1),
                                           "Limpeza programada da caldeira (ramonagem e remoção de incrustações)."))
        self.r.events.append(Event("rec.caldeira", "REC-CAL-GER-01", "intervencao", date(2026, 6, 9), None,
                                   "Limpeza programada da Safrinha 2026 adiada (DEMO)."))
        self.r.events.append(Event("rec.secador", "REC-SEC-TRC-01", "intervencao", date(2025, 12, 1),
                                   date(2025, 12, 15), "Retrofit: isolamento de dutos e recuperação de calor do ar de exaustão."))

        util = lambda prod, hours, cap: np.where(hours > 0, np.minimum(1.2, prod / np.maximum(hours, 1e-9) / cap), 0.0)
        self.ctx["rec.despalha"] = {"P": P, "H": H, "U": util(P, H, CAP_RATE["rec.despalha"])}
        pdeb = 0.86 * P
        self.ctx["rec.debulha"] = {"P": pdeb, "H": H, "U": util(pdeb, H, CAP_RATE["rec.debulha"])}
        self.ctx["rec.secador"] = {"P": dry, "H": h_sec, "U": util(wet, h_sec, CAP_RATE["rec.secador"])}
        self.ctx["rec.caldeira"] = {"P": S, "H": h_sec, "U": util(S, h_sec, CAP_RATE["rec.caldeira"]), "k": None}

        a = self._arr
        a("REC-DSP.PROD")[:] = P
        a("REC-DEB.PROD")[:] = pdeb
        a("REC-SEC.PROD")[:] = dry
        a("REC-SEC.PUMIDO")[:] = wet
        a("REC-SEC.AGUA")[:] = water
        a("REC-SEC.UIN")[:] = UIN
        a("REC-SEC.UOUT")[:] = UOUT
        a("REC-SEC.TAMB")[:] = TAMB
        a("REC-SEC-TRC-01.VAP")[:] = V
        a("REC-SEC-TRC-01.HOP")[:] = h_sec
        a("REC-CAL-GER-01.VAP")[:] = S
        a("REC-CAL-GER-01.BIO")[:] = BIO
        a("REC-CAL-GER-01.HOP")[:] = h_sec
        a("REC-CAL-GER-01.TG")[:] = TG
        a("REC-CAL-GER-01.O2")[:] = O2
        self.dry = dry

    # ------------------------------------------------------------------ torre
    def simulate_tower(self):
        rng = self.rng
        inv_dry, inv_cls = 9000.0, 7000.0
        CLEAN = np.zeros(N); HL = np.zeros(N); CLS = np.zeros(N); DESC = np.zeros(N); HC = np.zeros(N)
        TRT = np.zeros(N); HT = np.zeros(N); LOTS = np.zeros(N); ENS = np.zeros(N); SACOS = np.zeros(N)
        HE = np.zeros(N)
        for i, d in enumerate(DAYS):
            inv_dry += self.dry[i]
            md = (d.month, d.day)
            workday = d.weekday() < 6
            sat = 0.6 if d.weekday() == 5 else 1.0
            if (2, 1) <= md <= (11, 25) and workday and inv_dry > 40:
                rate = min(inv_dry, 540 * rng.uniform(0.7, 1.0) * sat)
                inv_dry -= rate
                CLEAN[i] = rate * 0.97
                HL[i] = float(np.clip(rate / 540 * 22 + 1.5 + rng.normal(0, 0.8), 5, 24))
                CLS[i] = CLEAN[i] * rng.uniform(0.86, 0.90)
                DESC[i] = CLEAN[i] - CLS[i]
                HC[i] = HL[i] * rng.uniform(0.95, 1.0)
                inv_cls += CLS[i]
            in_trt = (6, 1) <= md <= (12, 18) or (1, 6) <= md <= (3, 15)
            if in_trt and workday and inv_cls > 30:
                pf = 1.0 if 8 <= d.month <= 10 else 0.75
                rate = min(inv_cls, 420 * rng.uniform(0.5, 1.0) * pf * sat)
                inv_cls -= rate
                TRT[i] = rate
                LOTS[i] = max(1, round(rate / 38 * rng.uniform(0.9, 1.1)))
                HT[i] = float(np.clip(rate / 420 * 20 + 2, 4, 22))
                ENS[i] = rate * rng.uniform(0.995, 1.0)
                SACOS[i] = round(ENS[i] * 50 * rng.uniform(0.99, 1.01))
                HE[i] = min(24.0, HT[i] + 1)
                self.r.lots.append((d, int(LOTS[i]), float(rate)))
        util = lambda prod, hours, cap: np.where(hours > 0, np.minimum(1.2, prod / np.maximum(hours, 1e-9) / cap), 0.0)
        self.ctx["tor.limpeza"] = {"P": CLEAN, "H": HL, "U": util(CLEAN, HL, CAP_RATE["tor.limpeza"])}
        self.ctx["tor.classificacao"] = {"P": CLS, "H": HC, "U": util(CLEAN, HC, CAP_RATE["tor.classificacao"])}
        self.ctx["tor.tratamento"] = {"P": TRT, "H": HT, "U": util(TRT, HT, CAP_RATE["tor.tratamento"]), "L": LOTS}
        self.ctx["tor.ensaque"] = {"P": ENS, "H": HE, "U": util(ENS, HE, CAP_RATE["tor.ensaque"]), "S": SACOS}
        a = self._arr
        a("TOR-LIM.PROD")[:] = CLEAN
        a("TOR-CLA.PROD")[:] = CLS
        a("TOR-CLA.DESC")[:] = DESC
        a("TOR-TRA.PROD")[:] = TRT
        a("TOR-TRA.LOTES")[:] = LOTS
        a("TOR-ENS.PROD")[:] = ENS
        a("TOR-ENS.SACOS")[:] = SACOS

    # ------------------------------------------------------------------ motores
    def simulate_motors(self):
        rng = self.rng
        self.proc_eat = {p: np.zeros(N) for p in PROC_PREFIX}
        self.proc_evz = {p: np.zeros(N) for p in PROC_PREFIX}
        for m in MOTORS:
            c = self.ctx[m.proc]
            EAT, HOP, HVZ, EVZ = (self._arr(f"{m.tag}.{s}") for s in ("EAT", "HOP", "HVZ", "EVZ"))
            FP, IMED, NP = (self._arr(f"{m.tag}.{s}") for s in ("FP", "IMED", "NPART"))
            for i, d in enumerate(DAYS):
                h = c["H"][i]
                if h <= 0:
                    # medidor reporta zero (equipamento desligado) — zero medido, não ausência de dado
                    EAT[i] = HOP[i] = HVZ[i] = EVZ[i] = NP[i] = 0.0
                    continue
                hop = min(24.0, h * m.hours_mult * rng.uniform(0.97, 1.0))
                idle = m.idle * self._ln(0.15)
                lf = m.lf_load * (0.88 + 0.2 * min(1.0, c["U"][i])) * self._ln(0.03)
                pf = m.pf
                vfd = m.vfd
                starts = m.starts
                lf_idle = m.lf_idle
                # ---- histórias
                if m.tag == "REC-DEB-MOT-02" and d >= date(2026, 1, 1):
                    idle += 0.16 * _ramp(d, date(2026, 1, 1), date(2026, 3, 1))
                    starts *= 1.8
                if m.tag == "REC-SEC-VEN-03" and d >= date(2026, 7, 20):
                    lf = 0.99 * self._ln(0.02)
                    pf -= 0.03
                if m.tag == "TOR-LIM-ASP-01" and d >= date(2026, 7, 1):
                    lf *= 1 + 0.30 * _ramp(d, date(2026, 7, 1), date(2026, 8, 20))
                if m.tag == "TOR-LIM-ELV-01" and d < date(2025, 3, 10):
                    vfd, lf, lf_idle, pf = False, lf * 1.12, 0.38, 0.84
                if m.tag == "REC-CAL-VID-01":
                    steam_rate = self.ctx["rec.caldeira"]["P"][i] / max(h, 1)
                    lf = (0.25 + 0.6 * min(1.0, steam_rate / 20) ** 1.3) * self._ln(0.03)
                    if d >= date(2026, 6, 1):
                        lf *= 1.06
                lf = float(np.clip(lf, 0.15, 1.15))
                idle = float(np.clip(idle, 0.0, 0.6))
                hvz = hop * idle
                hprod = hop - hvz
                eta = m.eta / 100 * (1 - 0.05 * max(0.0, 0.5 - lf))
                if vfd:
                    lf_idle = 0.12
                e_load = m.pn * lf / eta * hprod
                evz = m.pn * lf_idle / (m.eta / 100) * hvz
                eat = e_load + evz
                fp = (0.95 + rng.normal(0, 0.005)) if vfd else (pf - 0.10 * max(0.0, 0.7 - lf) + rng.normal(0, 0.008))
                EAT[i], HOP[i], HVZ[i], EVZ[i] = eat, hop, hvz, evz
                FP[i] = min(0.99, fp)
                IMED[i] = (eat / hop) * 1000 / (math.sqrt(3) * m.voltage * FP[i])
                NP[i] = float(rng.poisson(starts))
            self.proc_eat[m.proc] += np.nan_to_num(EAT)
            self.proc_evz[m.proc] += np.nan_to_num(EVZ)
        self.r.events += [
            Event("tor.limpeza", "TOR-LIM-ELV-01", "intervencao", date(2025, 3, 3), date(2025, 3, 10),
                  "Instalação de inversores de frequência nos elevadores EL-10/11."),
            Event("rec.secador", "REC-SEC-VEN-03", "parada", date(2026, 7, 20), None,
                  "Damper do ventilador 03 identificado travado em posição aberta (DEMO)."),
            Event("tor.limpeza", "TOR-LIM-ASP-01", "intervencao", date(2026, 8, 25), None,
                  "Inspeção do filtro de mangas agendada — ΔP elevado (DEMO)."),
            Event("tor.classificacao", "TOR-CLA-MDS-01", "falha_dados", date(2026, 8, 10), date(2026, 8, 21),
                  "Falha de comunicação Modbus do multimedidor das mesas densimétricas."),
            Event("rec.debulha", "REC-DEB-MOT-02", "intervencao", date(2026, 1, 5), None,
                  "Mudança de prática operacional: debulhador mantido ligado entre cargas (DEMO)."),
        ]

    # ------------------------------------------------------------------ ar comprimido
    def simulate_compressed_air(self):
        rng = self.rng
        lim, cla, tra, ens = (self.ctx[p] for p in ("tor.limpeza", "tor.classificacao", "tor.tratamento", "tor.ensaque"))
        a = self._arr
        Q, PR = a("TOR-ENS.AR"), a("TOR-ENS.PRESS")
        c1 = {s: a(f"TOR-ENS-CMP-01.{s}") for s in ("EAT", "HOP", "HVZ", "EVZ", "FP", "IMED", "NPART")}
        c2 = {s: a(f"TOR-ENS-CMP-02.{s}") for s in ("EAT", "HOP", "HVZ", "EVZ", "FP", "IMED", "NPART")}
        prev_on = False
        for i, d in enumerate(DAYS):
            sys_h = max(lim["H"][i], cla["H"][i], tra["H"][i], ens["H"][i])
            if d.year <= 2024:
                leak = 150.0
            elif d.year == 2025:
                leak = 165.0
            else:
                leak = 170 + 130 * _ramp(d, date(2026, 1, 1), date(2026, 8, 31))
            left_on = sys_h == 0 and prev_on and d.weekday() == 6 and d.year == 2026 and rng.random() < 0.45
            prev_on = sys_h > 0
            if left_on:
                sys_h = 24.0
            if sys_h <= 0:
                for dct in (c1, c2):
                    for s in ("EAT", "HOP", "HVZ", "EVZ", "NPART"):
                        dct[s][i] = 0.0
                Q[i] = 0.0
                continue
            q = 9000 * ens["P"][i] / 350 + 4200 * lim["P"][i] / 520 + 1200 * tra.get("L")[i] / 10 + leak * sys_h
            press = (7.6 if d >= date(2026, 5, 1) else 7.2) + rng.normal(0, 0.08)
            pen = 1 + 0.07 * (press - 7.2)
            Q[i], PR[i] = q, press
            qh = q / sys_h
            q1 = min(qh, 700)
            lf1 = q1 / 750
            e1 = q1 * sys_h * 0.104 * (1 + 0.25 * (1 - lf1) ** 2) * pen
            c1["EAT"][i], c1["HOP"][i] = e1, sys_h
            c1["HVZ"][i] = sys_h * 0.02
            c1["EVZ"][i] = c1["HVZ"][i] * 75 * 0.10
            c1["FP"][i] = 0.96 + rng.normal(0, 0.004)
            c1["IMED"][i] = (e1 / sys_h) * 1000 / (math.sqrt(3) * 380 * c1["FP"][i])
            c1["NPART"][i] = float(rng.poisson(0.5))
            if qh > 700 or rng.random() < 0.15:
                ol = min(1.0, max(0.0, qh - 700) / 720)
                hload = sys_h * ol
                hunl = (sys_h - hload) * 0.7
                hop2 = hload + hunl
                e2 = hload * 75 / 0.945 * pen + hunl * 75 * 0.30
                c2["EAT"][i], c2["HOP"][i], c2["HVZ"][i] = e2, hop2, hunl
                c2["EVZ"][i] = hunl * 75 * 0.30
                c2["FP"][i] = 0.88 - 0.1 * (1 - ol) + rng.normal(0, 0.01)
                c2["IMED"][i] = (e2 / max(hop2, 0.1)) * 1000 / (math.sqrt(3) * 380 * c2["FP"][i])
                c2["NPART"][i] = float(rng.poisson(6 + 18 * min(1.0, leak / 300)))
            else:
                for s in ("EAT", "HOP", "HVZ", "EVZ", "NPART"):
                    c2[s][i] = 0.0
        self.air_eat = np.nan_to_num(c1["EAT"]) + np.nan_to_num(c2["EAT"])
        self.air_evz = np.nan_to_num(c1["EVZ"]) + np.nan_to_num(c2["EVZ"])
        self.air_left_on = None

    # ------------------------------------------------------------------ CCMs e variáveis de processo
    def simulate_process_meters(self):
        rng = self.rng
        for proc, prefix in PROC_PREFIX.items():
            c = self.ctx[proc]
            eat = self.proc_eat[proc].copy()
            evz = self.proc_evz[proc].copy()
            if proc == "tor.ensaque":
                eat += self.air_eat
                evz += self.air_evz
            aux = AUX_SHARE[proc]
            base = BASE_KWH[proc]
            hprod = np.where(c["H"] > 0, c["H"] * (1 - 0.05 * np.exp(rng.normal(0, 0.15, N))), 0.0)
            ccm = eat * (1 + aux) + base * np.exp(rng.normal(0, 0.05, N))
            no_prod = c["P"] <= 0
            esp = np.where(no_prod, ccm, evz * (1 + aux) + base * (1 - hprod / 24))
            self._arr(f"{prefix}.EAT")[:] = ccm
            self._arr(f"{prefix}.ESP")[:] = esp
            self._arr(f"{prefix}.HPROD")[:] = hprod

    # ------------------------------------------------------------------ falhas de dados
    def inject_data_issues(self):
        rng = self.rng
        outage = [IDX[date(2026, 8, 10) + timedelta(days=k)] for k in range(12)]
        for code, arr in self.r.values.items():
            q = self.r.quality.setdefault(code, {})
            if code.startswith("TOR-CLA-MDS-01."):
                arr[outage] = np.nan
            if code in ("REC-SEC.UIN", "REC-SEC.UOUT"):
                drop = rng.random(N) < 0.12
                arr[drop] = np.nan
                for i in np.where(~np.isnan(arr))[0]:
                    q[int(i)] = "manual"
                continue
            drop = rng.random(N) < 0.006
            arr[drop] = np.nan
            valid = np.where(~np.isnan(arr))[0]
            for i in valid[rng.random(len(valid)) < 0.0025]:
                q[int(i)] = "suspect"
            for i in valid[rng.random(len(valid)) < 0.0008]:
                q[int(i)] = "bad"

    def run(self) -> SimResult:
        self.simulate_receiving()
        self.simulate_tower()
        self.simulate_motors()
        self.simulate_compressed_air()
        self.simulate_process_meters()
        # FP/corrente só existem com equipamento operando: dias parados não geram linha
        for code in list(self.r.values):
            if code.endswith(".FP") or code.endswith(".IMED"):
                hop = self.r.values.get(code.rsplit(".", 1)[0] + ".HOP")
                if hop is not None:
                    self.r.values[code][~(np.nan_to_num(hop) > 0)] = np.nan
            if code in ("REC-CAL-GER-01.TG", "REC-CAL-GER-01.O2", "TOR-ENS.PRESS"):
                pass
        self.inject_data_issues()
        return self.r
