"""Status do indicador — regra configurável por indicador (sem limites universais).

status_rule = {"basis": "target" | "baseline", "tolerance_pct": 2.0, "critical_pct": 10.0}

  normal     → "Dentro da meta": desvio desfavorável <= tolerância
  atencao    → "Atenção": tolerância < desvio <= crítico
  critico    → "Desvio significativo": desvio > crítico, ou limite operacional absoluto violado
  sem_dados  → "Sem dados suficientes": completude abaixo do mínimo ou valor indefinido
  sem_operacao → "Sem operação": etapa/equipamento parado ou sem produção (não é falha de dado)
  sem_meta   → "Informativo": não há meta/baseline para comparar
"""
from __future__ import annotations

from dataclasses import dataclass

STATUS_LABELS = {
    "normal": "Dentro da meta",
    "atencao": "Atenção",
    "critico": "Desvio significativo",
    "sem_dados": "Sem dados suficientes",
    "sem_operacao": "Sem operação",
    "sem_meta": "Informativo",
}
STATUS_SEVERITY = {"critico": 5, "atencao": 4, "sem_dados": 3, "normal": 2, "sem_meta": 1, "sem_operacao": 0}

DEFAULT_RULE = {"basis": "target", "tolerance_pct": 2.0, "critical_pct": 10.0}


@dataclass
class StatusResult:
    status: str
    reference: float | None  # valor usado como referência
    deviation_pct: float | None  # desvio desfavorável (+) ou favorável (-) em %
    explanation: str


def unfavorable_deviation_pct(value: float, ref: float, direction: str) -> float | None:
    if ref == 0:
        return None
    raw = (value - ref) / abs(ref) * 100
    if direction == "higher_better":
        return -raw
    return raw


def evaluate_status(
    value: float | None,
    completeness_pct: float,
    min_completeness_pct: float,
    direction: str,
    rule: dict | None,
    target: float | None,
    target_min: float | None,
    target_max: float | None,
    baseline: float | None,
    upper_limit: float | None = None,
    lower_limit: float | None = None,
) -> StatusResult:
    rule = {**DEFAULT_RULE, **(rule or {})}
    tol = float(rule.get("tolerance_pct", 2.0))
    crit = float(rule.get("critical_pct", 10.0))

    if completeness_pct < min_completeness_pct:
        return StatusResult(
            "sem_dados", None, None,
            f"Completude {completeness_pct:.0f}% abaixo do mínimo de {min_completeness_pct:.0f}%.",
        )
    if value is None:
        return StatusResult("sem_dados", None, None, "Valor indefinido no período.")

    if upper_limit is not None and value > upper_limit:
        return StatusResult("critico", upper_limit, None, f"Acima do limite operacional ({upper_limit:g}).")
    if lower_limit is not None and value < lower_limit:
        return StatusResult("critico", lower_limit, None, f"Abaixo do limite operacional ({lower_limit:g}).")

    if direction == "target_range" and target_min is not None and target_max is not None:
        width = max(abs(target_max - target_min), 1e-9)
        if target_min <= value <= target_max:
            return StatusResult("normal", None, 0.0, f"Dentro da faixa {target_min:g}–{target_max:g}.")
        dist = (target_min - value) if value < target_min else (value - target_max)
        dev = dist / width * 100
        status = "atencao" if dev <= crit else "critico"
        return StatusResult(status, None, dev, f"Fora da faixa {target_min:g}–{target_max:g} ({dev:.1f}% da largura).")

    ref = baseline if rule.get("basis") == "baseline" else target
    ref_name = "baseline" if rule.get("basis") == "baseline" else "meta"
    if ref is None or direction == "none":
        return StatusResult("sem_meta", None, None, "Indicador sem meta/baseline definida.")

    dev = unfavorable_deviation_pct(value, ref, direction)
    if dev is None:
        return StatusResult("sem_meta", ref, None, f"{ref_name.capitalize()} igual a zero.")
    if dev <= tol:
        text = "melhor que" if dev < 0 else "dentro da tolerância da"
        return StatusResult("normal", ref, dev, f"{abs(dev):.1f}% {text} {ref_name}.")
    if dev <= crit:
        return StatusResult("atencao", ref, dev, f"{dev:.1f}% pior que a {ref_name} (tolerância {tol:g}%).")
    return StatusResult("critico", ref, dev, f"{dev:.1f}% pior que a {ref_name} (limite crítico {crit:g}%).")
