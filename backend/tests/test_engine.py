"""Motor de indicadores sobre a base DEMO: agregação, completude, unidades, status e estatística."""
from datetime import date

import pytest
from sqlalchemy import select

from app.engine.indicators import IndicatorEngine
from app.engine.repository import SeriesRepository
from app.engine.stats import control_chart, lmdi, linear_trend, moving_average
from app.engine.status import evaluate_status
from app.models import Indicator, Variable
from app.services.context import period_context


def ind_by_code(db, code) -> Indicator:
    return db.scalar(select(Indicator).where(Indicator.code == code))


def test_ratio_is_sum_over_sum_not_mean_of_daily_ratios(db):
    """kWh/t do mês = Σ kWh / Σ t. A média das razões diárias dá outro número (e é errada)."""
    ctx = period_context(db)
    period = ctx.resolve("month:2026-08")
    ind = ind_by_code(db, "IDE-REC-DSP-INT")
    engine = IndicatorEngine(db)
    ev = engine.evaluate([ind], period)[ind.id]
    comps = {c.symbol: c.value for c in ev.components}
    assert ev.value == pytest.approx(comps["E"] / comps["P"], rel=1e-9)

    daily = engine.series(ind, period.eff_start, period.eff_end, "day")
    ratios = [p["value"] for p in daily if p["value"] is not None]
    mean_of_ratios = sum(ratios) / len(ratios)
    assert abs(mean_of_ratios - ev.value) / ev.value > 0.005  # comprovadamente diferente


def test_period_value_matches_manual_sum(db):
    ctx = period_context(db)
    period = ctx.resolve("week:2026-W32")
    ind = ind_by_code(db, "IDE-REC-DSP-INT")
    repo = SeriesRepository(db)
    bindings = {b.symbol: b.variable_id for b in ind.bindings}
    aggs = repo.period_aggregates(list(bindings.values()), period.eff_start, period.eff_end)
    expected = aggs[bindings["E"]].sum / aggs[bindings["P"]].sum
    ev = IndicatorEngine(db).evaluate([ind], period)[ind.id]
    assert ev.value == pytest.approx(expected)


def test_missing_data_reduces_completeness_and_blocks_status(db):
    """Falha de comunicação do medidor (10–21/08/2026) deixa o indicador sem dados suficientes."""
    ctx = period_context(db)
    ind = ind_by_code(db, "IDE-TOR-CLA-MDS-01-KWHT")
    ev = IndicatorEngine(db).evaluate([ind], ctx.resolve("month:2026-08"))[ind.id]
    assert ev.completeness_pct < 80
    assert ev.status == "sem_dados"
    assert ev.value is not None  # valor existe, mas não é confiável — não é apagado nem zerado


def test_no_production_is_not_a_data_failure(db):
    """Entressafra: sem produção o indicador fica indefinido com status 'sem operação', nunca zero."""
    ctx = period_context(db)
    ind = ind_by_code(db, "IDE-REC-DSP-INT")
    ev = IndicatorEngine(db).evaluate([ind], ctx.resolve("month:2025-11"))[ind.id]
    assert ev.value is None
    assert ev.status == "sem_operacao"
    assert "produção" in (ev.reason or "")


def test_unit_conversion_in_binding(db):
    """Conversão declarada no vínculo (kWh → MWh) divide o valor por 1000."""
    from app.engine.indicators import IndicatorEngine as E
    from app.models import IndicatorBinding, Unit

    ctx = period_context(db)
    period = ctx.resolve("month:2026-08")
    ind = ind_by_code(db, "IDE-REC-DSP-INT")
    base = E(db).evaluate([ind], period)[ind.id].value
    mwh = db.scalar(select(Unit).where(Unit.symbol == "MWh"))
    clone = Indicator(
        id=-99, code="TMP", name="tmp", kind="extrinsic", category="intensidade", node_id=ind.node_id,
        formula=ind.formula, unit_id=ind.unit_id, direction="lower_better", status_rule={},
        min_completeness_pct=0, stability_band_pct=3,
    )
    clone.bindings = [
        IndicatorBinding(symbol=b.symbol, source_type=b.source_type, variable_id=b.variable_id,
                         unit_id=mwh.id if b.symbol == "E" else None)
        for b in ind.bindings
    ]
    converted = E(db).evaluate([clone], period)[clone.id].value
    assert converted == pytest.approx(base / 1000, rel=1e-9)


def test_operating_basis_ignores_days_without_operation(db):
    """Fator de potência só existe com o motor girando: dias parados não contam como dado ausente."""
    ctx = period_context(db)
    ind = ind_by_code(db, "IDE-REC-DSP-MOT-01-FP")
    engine = IndicatorEngine(db)
    assert ind.operating_variable_id is not None

    operating = engine.evaluate([ind], ctx.resolve("month:2026-08"))[ind.id]
    assert 0 < operating.operating_days <= 31
    assert operating.completeness_pct >= 90  # completude medida sobre os dias de operação
    assert 0.5 < operating.value < 1.0

    # Junho/2026 tem a virada entre safra verão e safrinha: parte do mês sem operação
    partial = engine.evaluate([ind], ctx.resolve("custom:2026-06-01..2026-06-30"))[ind.id]
    assert partial.operating_days < 30
    assert partial.completeness_pct >= 90  # dias parados não são contados como dado faltante

    stopped = engine.evaluate([ind], ctx.resolve("month:2025-11"))[ind.id]
    assert stopped.operating_days == 0 and stopped.status == "sem_operacao"


def test_seasonal_target_is_used_for_short_periods(db):
    """Meta de janela de safra para o mês; meta anual para o Crop Year."""
    ctx = period_context(db)
    ind = ind_by_code(db, "IDE-REC-SEC-INT")
    engine = IndicatorEngine(db)
    month = engine.evaluate([ind], ctx.resolve("month:2026-08"))[ind.id]
    crop = engine.evaluate([ind], ctx.resolve("crop_year:CY2026"))[ind.id]
    assert month.target != crop.target


def test_status_rule_is_per_indicator():
    common = dict(completeness_pct=100, min_completeness_pct=80, direction="lower_better",
                  target=100.0, target_min=None, target_max=None, baseline=None)
    tight = evaluate_status(value=105, rule={"tolerance_pct": 2, "critical_pct": 4}, **common)
    loose = evaluate_status(value=105, rule={"tolerance_pct": 10, "critical_pct": 20}, **common)
    assert tight.status == "critico" and loose.status == "normal"
    faixa = dict(completeness_pct=100, min_completeness_pct=80, direction="target_range", target=None,
                 target_min=40, target_max=90, baseline=None)
    assert evaluate_status(value=70, rule={"critical_pct": 20}, **faixa).status == "normal"
    assert evaluate_status(value=95, rule={"critical_pct": 20}, **faixa).status == "atencao"
    assert evaluate_status(value=95, rule={"critical_pct": 5}, **faixa).status == "critico"


def test_insufficient_completeness_overrides_value():
    r = evaluate_status(value=10, completeness_pct=50, min_completeness_pct=80, direction="lower_better",
                        rule=None, target=10, target_min=None, target_max=None, baseline=None)
    assert r.status == "sem_dados"


def test_history_detects_deterioration_story(db):
    """Debulhador 02 passa a operar em vazio a partir de jan/2026 — a série deve acusar deterioração."""
    ind = ind_by_code(db, "IDE-REC-DEB-MOT-02-VAZ")
    hist = IndicatorEngine(db).history(ind, date(2025, 9, 1), date(2026, 8, 31), "week")
    assert hist["trend"]["classification"] == "deterioracao"
    assert hist["control"]["applicable"]
    assert hist["control"]["shift_detected_at"] is not None


def test_history_detects_improvement_story(db):
    """Retrofit do secador (dez/2025) reduz a energia por água evaporada de um Crop Year para o outro."""
    ctx = period_context(db)
    ind = ind_by_code(db, "IDE-REC-SEC-TER-MJKG")
    engine = IndicatorEngine(db)
    before = engine.evaluate([ind], ctx.resolve("crop_year:CY2025"))[ind.id].value
    after = engine.evaluate([ind], ctx.resolve("crop_year:CY2026"))[ind.id].value
    assert after < before * 0.95
    hist = engine.history(ind, date(2024, 9, 1), date(2026, 8, 31), "month")
    assert hist["trend"]["classification"] == "melhoria"


def test_moving_average_and_trend_helpers():
    assert moving_average([1, 2, 3, 4], 2)[-1] == pytest.approx(3.5)
    assert moving_average([None, None, 3, 4], 2)[0] is None
    up = linear_trend([1, 2, 3, 4, 5, 6], "lower_better", 3.0)
    assert up.classification == "deterioracao" and up.slope_per_bucket == pytest.approx(1.0)
    flat = linear_trend([10, 10.1, 9.9, 10, 10.05, 9.95], "lower_better", 3.0)
    assert flat.classification == "estavel"
    assert linear_trend([1, 2], "lower_better", 3).classification == "insuficiente"


def test_control_chart_rules():
    values = [10, 11, 9, 10, 10.5, 9.5, 10, 11, 9, 10, 10, 9.8, 30]
    cc = control_chart(values)
    assert cc.applicable and 12 in cc.out_of_control
    assert control_chart([1, 2, 3]).applicable is False


def test_lmdi_decomposition_is_exact():
    d = lmdi(e0=1000, e1=1200, p0=500, p1=700)
    assert d["production_effect"] + d["intensity_effect"] == pytest.approx(d["delta_energy"])
    assert d["production_effect"] > 0 and d["intensity_effect"] < 0  # mais produção, menos intensidade
    assert lmdi(0, 10, 5, 5) is None


def test_energy_totals_avoid_double_counting_internal_carriers(db):
    """Vapor é contado no Secador, mas não no Recebimento (que contém a Caldeira que o gera)."""
    from app.models import HierarchyNode
    from app.services.energy import EnergyService

    ctx = period_context(db)
    period = ctx.resolve("month:2026-08")
    svc = EnergyService(db)
    rec = db.scalar(select(HierarchyNode).where(HierarchyNode.code == "recebimento"))
    sec = db.scalar(select(HierarchyNode).where(HierarchyNode.code == "rec.secador"))
    rec_carriers = {c["carrier"] for c in svc.summary(rec, period)["by_carrier"]}
    sec_carriers = {c["carrier"] for c in svc.summary(sec, period)["by_carrier"]}
    assert "vapor" not in rec_carriers and "biomassa" in rec_carriers
    assert "vapor" in sec_carriers


def test_variable_aggregation_respects_configuration(db):
    """Variáveis de média (umidade) não são somadas ao agregar o período."""
    v = db.scalar(select(Variable).where(Variable.code == "REC-SEC.UIN"))
    assert v.aggregation == "avg"
    agg = SeriesRepository(db).period_aggregates([v.id], date(2026, 3, 1), date(2026, 3, 31))[v.id]
    assert 15 < agg.avg < 45 and agg.sum > agg.avg
