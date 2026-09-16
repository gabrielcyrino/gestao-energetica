"""Estatística aplicada à análise de desempenho energético.

- média móvel, tendência linear (OLS) com classificação sensível à direção desejada;
- gráfico de controle de valores individuais (I-MR) e regra de sequência (8 pontos do mesmo lado);
- decomposição LMDI da variação de consumo em efeito produção × efeito intensidade;
- regressão linear múltipla para linha de base (consumo esperado).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

MIN_TREND_POINTS = 6
MIN_CONTROL_POINTS = 12
RUN_RULE_LENGTH = 8


def moving_average(values: list[float | None], window: int) -> list[float | None]:
    out: list[float | None] = []
    need = max(1, math.ceil(window / 2))
    for i in range(len(values)):
        chunk = [v for v in values[max(0, i - window + 1) : i + 1] if v is not None]
        out.append(sum(chunk) / len(chunk) if len(chunk) >= need else None)
    return out


@dataclass
class TrendResult:
    classification: str  # melhoria | deterioracao | estavel | aumento | reducao | insuficiente
    slope_per_bucket: float | None = None
    relative_change_pct: float | None = None
    r2: float | None = None
    n: int = 0
    fitted: list[float | None] = field(default_factory=list)


def linear_trend(values: list[float | None], direction: str, stability_band_pct: float) -> TrendResult:
    idx = [i for i, v in enumerate(values) if v is not None]
    if len(idx) < MIN_TREND_POINTS:
        return TrendResult("insuficiente", n=len(idx), fitted=[None] * len(values))
    x = np.array(idx, dtype=float)
    y = np.array([values[i] for i in idx], dtype=float)
    slope, intercept = np.polyfit(x, y, 1)
    pred = slope * x + intercept
    ss_res = float(np.sum((y - pred) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    mean = float(np.mean(y))
    span = x[-1] - x[0]
    rel = float(slope * span / abs(mean) * 100) if mean != 0 else None
    fitted = [float(slope * i + intercept) if lo_ok else None for i, lo_ok in enumerate(_between(values, idx))]

    if rel is None or abs(rel) < stability_band_pct:
        cls = "estavel"
    elif direction == "lower_better":
        cls = "melhoria" if rel < 0 else "deterioracao"
    elif direction == "higher_better":
        cls = "melhoria" if rel > 0 else "deterioracao"
    else:
        cls = "aumento" if rel > 0 else "reducao"
    return TrendResult(cls, float(slope), rel, r2, len(idx), fitted)


def _between(values: list, idx: list[int]) -> list[bool]:
    lo, hi = idx[0], idx[-1]
    return [lo <= i <= hi for i in range(len(values))]


@dataclass
class ControlChart:
    applicable: bool
    reason: str | None = None
    center: float | None = None
    ucl: float | None = None
    lcl: float | None = None
    mr_bar: float | None = None
    out_of_control: list[int] = field(default_factory=list)
    shift_start: int | None = None  # início de sequência >= 8 pontos do mesmo lado da média


def control_chart(values: list[float | None]) -> ControlChart:
    idx = [i for i, v in enumerate(values) if v is not None]
    if len(idx) < MIN_CONTROL_POINTS:
        return ControlChart(False, f"são necessários ao menos {MIN_CONTROL_POINTS} pontos válidos")
    y = [values[i] for i in idx]
    center = sum(y) / len(y)
    mrs = [abs(y[i] - y[i - 1]) for i in range(1, len(y))]
    mr_bar = sum(mrs) / len(mrs)
    if mr_bar == 0:
        return ControlChart(False, "série sem variação", center=center)
    ucl, lcl = center + 2.66 * mr_bar, center - 2.66 * mr_bar
    ooc = [i for i in idx if values[i] > ucl or values[i] < lcl]
    shift_start = None
    run, side, run_start = 0, 0, None
    for i in idx:
        s = 1 if values[i] > center else (-1 if values[i] < center else 0)
        if s != 0 and s == side:
            run += 1
        else:
            side, run, run_start = s, (1 if s != 0 else 0), i
        if run >= RUN_RULE_LENGTH and shift_start is None:
            shift_start = run_start
    return ControlChart(True, None, center, ucl, lcl, mr_bar, ooc, shift_start)


def pct_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return (current - previous) / abs(previous) * 100


def lmdi(e0: float, e1: float, p0: float, p1: float) -> dict | None:
    """Decomposição LMDI-I (aditiva) de ΔE = efeito atividade (produção) + efeito intensidade."""
    if min(e0, e1, p0, p1) <= 0:
        return None
    i0, i1 = e0 / p0, e1 / p1
    weight = (e1 - e0) / (math.log(e1) - math.log(e0)) if not math.isclose(e1, e0) else e1
    activity = weight * math.log(p1 / p0)
    intensity = weight * math.log(i1 / i0)
    return {
        "delta_energy": e1 - e0,
        "production_effect": activity,
        "intensity_effect": intensity,
        "intensity_before": i0,
        "intensity_after": i1,
    }


@dataclass
class RegressionFit:
    intercept: float
    coefficients: dict[str, float]
    r2: float
    adj_r2: float
    cv_rmse_pct: float
    n: int
    t_stats: dict[str, float]


def fit_linear_regression(y: list[float], x: dict[str, list[float]]) -> RegressionFit:
    names = list(x)
    n, k = len(y), len(names)
    if n < k + 3:
        raise ValueError(f"Dados insuficientes para regressão: n={n}, variáveis={k}")
    X = np.column_stack([np.ones(n)] + [np.asarray(x[name], dtype=float) for name in names])
    Y = np.asarray(y, dtype=float)
    beta, *_ = np.linalg.lstsq(X, Y, rcond=None)
    pred = X @ beta
    resid = Y - pred
    ss_res = float(resid @ resid)
    ss_tot = float(((Y - Y.mean()) ** 2).sum())
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    dof = n - k - 1
    adj = 1 - (1 - r2) * (n - 1) / dof if dof > 0 else r2
    rmse = math.sqrt(ss_res / dof) if dof > 0 else float("nan")
    cv = rmse / float(Y.mean()) * 100 if Y.mean() else float("nan")
    try:
        cov = (ss_res / dof) * np.linalg.inv(X.T @ X)
        se = np.sqrt(np.diag(cov))
        t_stats = {name: float(beta[i + 1] / se[i + 1]) for i, name in enumerate(names)}
    except np.linalg.LinAlgError:
        t_stats = {}
    return RegressionFit(
        intercept=float(beta[0]),
        coefficients={name: float(beta[i + 1]) for i, name in enumerate(names)},
        r2=r2,
        adj_r2=adj,
        cv_rmse_pct=cv,
        n=n,
        t_stats=t_stats,
    )
