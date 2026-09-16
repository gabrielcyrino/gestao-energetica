"""Motor de cálculo dos IDEs.

Princípios:
1. Fórmula sobre agregados do período — kWh/t de um mês é Σ kWh / Σ t, e não a média das razões diárias.
2. Cada símbolo tem agregação própria (sum, avg, min, max, last, count) e conversão de unidade.
3. Completude explícita: dias com dado / dias esperados (calendário ou dias de operação).
4. Resultado indefinido (produção zero, variável sem dado) gera motivo — nunca zero.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.engine import formula as fx
from app.engine.periods import ResolvedPeriod, bucket_label, iter_buckets
from app.engine.repository import DailyStat, PeriodAgg, SeriesRepository
from app.engine.stats import control_chart, linear_trend, moving_average, pct_change
from app.engine.status import STATUS_LABELS, evaluate_status, unfavorable_deviation_pct
from app.engine.units import UnitError, UnitInfo, convert
from app.models import Equipment, Indicator, IndicatorBinding, IndicatorTarget, Unit, Variable

BUILTINS = {"PERIOD_DAYS": "dias do período", "PERIOD_HOURS": "horas do período (dias × 24)"}
AGGREGATIONS = {"sum", "avg", "min", "max", "last", "count"}


@dataclass
class ComponentValue:
    symbol: str
    source_type: str
    value: float | None
    unit: str | None
    aggregation: str | None = None
    variable_id: int | None = None
    variable_code: str | None = None
    variable_name: str | None = None
    variable_type: str | None = None
    days_with_data: int | None = None
    expected_days: int | None = None
    completeness_pct: float | None = None


@dataclass
class Evaluation:
    indicator_id: int
    value: float | None
    reason: str | None
    completeness_pct: float
    status: str
    status_label: str
    status_explanation: str
    deviation_pct: float | None
    target: float | None
    target_min: float | None
    target_max: float | None
    baseline: float | None
    deviation_target_pct: float | None
    deviation_baseline_pct: float | None
    expected_days: int
    operating_days: int | None
    components: list[ComponentValue] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class _Def:
    ind: Indicator
    compiled: fx.CompiledFormula | None
    error: str | None
    bindings: dict[str, IndicatorBinding]


class IndicatorEngine:
    def __init__(self, db: Session):
        self.db = db
        self.repo = SeriesRepository(db)
        self.units: dict[int, UnitInfo] = {
            u.id: UnitInfo(u.id, u.symbol, u.quantity, u.factor_to_base, u.offset_to_base)
            for u in db.scalars(select(Unit))
        }
        self._vars: dict[int, Variable] = {}
        self._equip: dict[int, Equipment] = {}

    # ------------------------------------------------------------------ carga das definições
    @staticmethod
    def load_indicators(db: Session, ids: list[int] | None = None, **filters) -> list[Indicator]:
        q = select(Indicator).options(
            selectinload(Indicator.bindings), selectinload(Indicator.targets), selectinload(Indicator.unit)
        )
        if ids is not None:
            q = q.where(Indicator.id.in_(ids))
        for k, v in filters.items():
            if v is not None:
                q = q.where(getattr(Indicator, k) == v)
        return list(db.scalars(q.where(Indicator.active.is_(True)).order_by(Indicator.id)))

    def _prepare(self, indicators: list[Indicator]) -> list[_Def]:
        defs = []
        var_ids, eq_ids = set(), set()
        for ind in indicators:
            try:
                compiled, err = fx.compile_formula(ind.formula), None
            except fx.FormulaError as exc:
                compiled, err = None, str(exc)
            bmap = {b.symbol: b for b in ind.bindings}
            if compiled and not err:
                unbound = compiled.symbols - set(bmap)
                if unbound:
                    err = f"Símbolos sem vínculo: {', '.join(sorted(unbound))}"
            defs.append(_Def(ind, compiled, err, bmap))
            var_ids |= {b.variable_id for b in ind.bindings if b.variable_id}
            if ind.operating_variable_id:
                var_ids.add(ind.operating_variable_id)
            if ind.equipment_id:
                eq_ids.add(ind.equipment_id)
        missing = var_ids - set(self._vars)
        if missing:
            for v in self.db.scalars(select(Variable).where(Variable.id.in_(missing))):
                self._vars[v.id] = v
        missing_eq = eq_ids - set(self._equip)
        if missing_eq:
            for e in self.db.scalars(select(Equipment).where(Equipment.id.in_(missing_eq))):
                self._equip[e.id] = e
        return defs

    # ------------------------------------------------------------------ valores de símbolos
    def _binding_value(
        self,
        d: _Def,
        b: IndicatorBinding,
        agg_of: callable,
        days: int,
    ) -> tuple[ComponentValue, str | None]:
        """Retorna (componente, erro). agg_of(variable_id, aggregation) -> (valor, dias_com_dado)."""
        match b.source_type:
            case "constant":
                return ComponentValue(b.symbol, "constant", b.constant_value, self._unit_symbol(b.unit_id)), None
            case "builtin":
                val = {"PERIOD_DAYS": float(days), "PERIOD_HOURS": float(days * 24)}.get(b.builtin or "")
                unit = "d" if b.builtin == "PERIOD_DAYS" else "h"
                err = None if val is not None else f"builtin desconhecido: {b.builtin}"
                return ComponentValue(b.symbol, "builtin", val, unit), err
            case "equipment_attribute":
                eq = self._equip.get(d.ind.equipment_id or -1)
                val = None
                if eq is not None and b.attribute:
                    if hasattr(Equipment, b.attribute):
                        val = getattr(eq, b.attribute)
                    else:
                        val = (eq.attributes or {}).get(b.attribute)
                val = float(val) if isinstance(val, (int, float)) else None
                err = None if val is not None else f"atributo '{b.attribute}' não informado no equipamento"
                return ComponentValue(b.symbol, "equipment_attribute", val, self._unit_symbol(b.unit_id)), err
            case "variable":
                var = self._vars.get(b.variable_id or -1)
                if var is None:
                    return ComponentValue(b.symbol, "variable", None, None), "variável não encontrada"
                aggregation = b.aggregation or var.aggregation
                raw, n_days = agg_of(var.id, aggregation)
                value, unit_sym, err = raw, self._unit_symbol(var.unit_id), None
                if raw is not None and b.unit_id and aggregation != "count" and b.unit_id != var.unit_id:
                    try:
                        value = convert(raw, self.units[var.unit_id], self.units[b.unit_id])
                        unit_sym = self.units[b.unit_id].symbol
                    except UnitError as exc:
                        value, err = None, str(exc)
                if aggregation == "count":
                    unit_sym = "d"
                return (
                    ComponentValue(
                        b.symbol, "variable", value, unit_sym, aggregation, var.id, var.code, var.name,
                        var.variable_type, n_days,
                    ),
                    err,
                )
        return ComponentValue(b.symbol, b.source_type, None, None), f"tipo de vínculo inválido: {b.source_type}"

    def _unit_symbol(self, unit_id: int | None) -> str | None:
        return self.units[unit_id].symbol if unit_id in self.units else None

    LONG_PERIOD_DAYS = 120

    @classmethod
    def _target_for(cls, ind: Indicator, start: date, at: date) -> IndicatorTarget | None:
        """Meta vigente na data final. Períodos longos preferem escopo anual; curtos, a janela de safra."""
        preferred = "annual" if (at - start).days + 1 > cls.LONG_PERIOD_DAYS else "seasonal"
        valid = [t for t in ind.targets if t.valid_from <= at and (t.valid_to is None or t.valid_to >= at)]
        if not valid:
            past = [t for t in ind.targets if t.valid_from <= at]
            valid = past[-1:] if past else ind.targets[:1]
        for scope in (preferred, "all"):
            chosen = [t for t in valid if t.scope == scope]
            if chosen:
                return chosen[-1]
        return valid[-1] if valid else None

    def _compute(
        self, d: _Def, agg_of, expected_days: int, calendar_days: int, start: date, at: date,
        operating_days: int | None,
    ) -> Evaluation:
        ind = d.ind
        components: list[ComponentValue] = []
        errors: list[str] = []
        for sym in sorted(d.bindings):
            comp, err = self._binding_value(d, d.bindings[sym], agg_of, calendar_days)
            if comp.source_type == "variable":
                comp.expected_days = expected_days
                comp.completeness_pct = (
                    min(100.0, (comp.days_with_data or 0) / expected_days * 100) if expected_days else 0.0
                )
            components.append(comp)
            if err:
                errors.append(f"{sym}: {err}")
        var_comps = [c for c in components if c.source_type == "variable"]
        completeness = min((c.completeness_pct or 0.0) for c in var_comps) if var_comps else 100.0

        value, reason = None, None
        if d.error:
            reason = f"Fórmula inválida — {d.error}"
        elif operating_days == 0:
            reason = "sem operação no período"
        else:
            try:
                value = fx.evaluate(d.compiled, {c.symbol: c.value for c in components})
            except fx.UndefinedValue as exc:
                reason = str(exc)
                prod_zero = [c for c in var_comps if c.variable_type == "production" and c.value == 0]
                if "divisão por zero" in reason and prod_zero:
                    reason = "sem produção no período"
                if errors:
                    reason = f"{reason} ({'; '.join(errors)})"
        if operating_days == 0:
            completeness = 100.0  # não operar não é falha de dado

        tgt = self._target_for(ind, start, at)
        target = tgt.target_value if tgt else None
        tmin = tgt.target_min if tgt else None
        tmax = tgt.target_max if tgt else None
        baseline = tgt.baseline_value if tgt else None
        st = evaluate_status(
            value, completeness, ind.min_completeness_pct, ind.direction, ind.status_rule,
            target, tmin, tmax, baseline, ind.upper_limit, ind.lower_limit,
        )
        if value is None and reason in ("sem operação no período", "sem produção no período"):
            st.status, st.explanation = "sem_operacao", reason.capitalize() + "."
        dev_t = unfavorable_deviation_pct(value, target, ind.direction) if value is not None and target else None
        dev_b = unfavorable_deviation_pct(value, baseline, ind.direction) if value is not None and baseline else None
        return Evaluation(
            indicator_id=ind.id,
            value=value,
            reason=reason,
            completeness_pct=round(completeness, 1),
            status=st.status,
            status_label=STATUS_LABELS[st.status],
            status_explanation=reason if (value is None and reason) else st.explanation,
            deviation_pct=st.deviation_pct,
            target=target,
            target_min=tmin,
            target_max=tmax,
            baseline=baseline,
            deviation_target_pct=dev_t,
            deviation_baseline_pct=dev_b,
            expected_days=expected_days,
            operating_days=operating_days,
            components=components,
        )

    # ------------------------------------------------------------------ período único
    def evaluate(self, indicators: list[Indicator], period: ResolvedPeriod) -> dict[int, Evaluation]:
        defs = self._prepare(indicators)
        if period.is_empty:
            empty = {}
            for d in defs:
                ev = self._compute(d, lambda *_: (None, 0), 0, 0, period.start, period.end, None)
                ev.reason = "período sem dados disponíveis"
                ev.status_explanation = ev.reason
                empty[d.ind.id] = ev
            return empty
        var_ids = [b.variable_id for d in defs for b in d.bindings.values() if b.variable_id]
        aggs = self.repo.period_aggregates(var_ids, period.eff_start, period.eff_end)
        need_last = [b.variable_id for d in defs for b in d.bindings.values() if b.variable_id and b.aggregation == "last"]
        lasts = self.repo.last_values(need_last, period.eff_start, period.eff_end) if need_last else {}

        op_ids = [d.ind.operating_variable_id for d in defs if d.ind.operating_variable_id]
        op_daily = self.repo.daily(op_ids, period.eff_start, period.eff_end) if op_ids else {}

        def make_agg_of(allowed_days: set[date] | None):
            def agg_of(vid: int, aggregation: str):
                a: PeriodAgg | None = aggs.get(vid)
                if a is None:
                    return None, 0
                n_days = a.days if allowed_days is None else min(a.days, len(allowed_days))
                return _pick(a, aggregation, lasts.get(vid)), n_days

            return agg_of

        out = {}
        for d in defs:
            op_days, days_on = None, None
            expected = period.days
            if d.ind.operating_variable_id:
                days_on = {day for day, s in op_daily.get(d.ind.operating_variable_id, {}).items() if s.sum > 0}
                op_days = len(days_on)
                expected = op_days
            out[d.ind.id] = self._compute(
                d, make_agg_of(days_on), expected, period.days, period.eff_start, period.eff_end, op_days
            )
        return out

    # ------------------------------------------------------------------ série temporal
    def series(self, ind: Indicator, start: date, end: date, grain: str) -> list[dict]:
        (d,) = self._prepare([ind])
        var_ids = [b.variable_id for b in d.bindings.values() if b.variable_id]
        if ind.operating_variable_id:
            var_ids.append(ind.operating_variable_id)
        daily = self.repo.daily(var_ids, start, end)
        points = []
        for b0, b1 in iter_buckets(start, end, grain):
            span = (b1 - b0).days + 1
            op_days = None
            expected = span
            allowed: set[date] | None = None
            if ind.operating_variable_id:
                allowed = {
                    day for day, s in daily.get(ind.operating_variable_id, {}).items() if b0 <= day <= b1 and s.sum > 0
                }
                op_days = len(allowed)
                expected = op_days

            def agg_of(vid: int, aggregation: str, _b0=b0, _b1=b1, _allowed=allowed):
                stats = [
                    (day, s) for day, s in daily.get(vid, {}).items()
                    if _b0 <= day <= _b1 and (_allowed is None or day in _allowed)
                ]
                if not stats:
                    return None, 0
                return _pick_daily(stats, aggregation), len(stats)

            ev = self._compute(d, agg_of, expected, span, b0, b1, op_days)
            points.append(
                {
                    "start": b0.isoformat(),
                    "end": b1.isoformat(),
                    "label": bucket_label(b0, grain),
                    "value": ev.value,
                    "reason": ev.reason,
                    "completeness_pct": ev.completeness_pct,
                    "status": ev.status,
                    "target": ev.target,
                    "baseline": ev.baseline,
                    "components": {c.symbol: c.value for c in ev.components},
                }
            )
        return points

    def history(self, ind: Indicator, start: date, end: date, grain: str, ma_window: int | None = None) -> dict:
        points = self.series(ind, start, end, grain)
        # Buckets com completude abaixo do mínimo são exibidos, mas não entram em tendência/controle.
        vals = [p["value"] if p["completeness_pct"] >= ind.min_completeness_pct else None for p in points]
        window = ma_window or {"day": 7, "week": 4, "month": 3}.get(grain, 3)
        ma = moving_average(vals, window)
        trend = linear_trend(vals, ind.direction, ind.stability_band_pct)
        cc = control_chart(vals)
        for i, p in enumerate(points):
            p["moving_avg"] = ma[i]
            p["trend"] = trend.fitted[i] if trend.fitted else None
            p["out_of_control"] = i in cc.out_of_control
        return {
            "grain": grain,
            "moving_average_window": window,
            "points": points,
            "trend": {
                "classification": trend.classification,
                "slope_per_bucket": trend.slope_per_bucket,
                "relative_change_pct": trend.relative_change_pct,
                "r2": trend.r2,
                "n": trend.n,
            },
            "control": {
                "applicable": cc.applicable,
                "reason": cc.reason,
                "center": cc.center,
                "ucl": cc.ucl,
                "lcl": cc.lcl,
                "out_of_control_count": len(cc.out_of_control),
                "shift_detected_at": points[cc.shift_start]["start"] if cc.shift_start is not None else None,
            },
        }

    # ------------------------------------------------------------------ comparação
    def compare(
        self, indicators: list[Indicator], a: ResolvedPeriod, b: ResolvedPeriod
    ) -> list[dict]:
        ea, eb = self.evaluate(indicators, a), self.evaluate(indicators, b)
        rows = []
        for ind in indicators:
            x, y = ea[ind.id], eb[ind.id]
            rows.append({"indicator_id": ind.id, "current": x.to_dict(), "previous": y.to_dict(), **change(ind, x.value, y.value)})
        return rows


def change(ind: Indicator, current: float | None, previous: float | None) -> dict:
    delta = current - previous if current is not None and previous is not None else None
    pct = pct_change(current, previous)
    if pct is None:
        cls = "indefinido"
    elif abs(pct) < ind.stability_band_pct:
        cls = "estavel"
    elif ind.direction == "lower_better":
        cls = "melhoria" if pct < 0 else "piora"
    elif ind.direction == "higher_better":
        cls = "melhoria" if pct > 0 else "piora"
    else:
        cls = "aumento" if pct > 0 else "reducao"
    return {"delta": delta, "delta_pct": pct, "change_class": cls}


def _pick(a: PeriodAgg, aggregation: str, last: float | None) -> float | None:
    match aggregation:
        case "sum":
            return a.sum
        case "avg":
            return a.avg
        case "min":
            return a.min
        case "max":
            return a.max
        case "last":
            return last
        case "count":
            return float(a.days)
    return None


def _pick_daily(stats: list[tuple[date, DailyStat]], aggregation: str) -> float | None:
    match aggregation:
        case "sum":
            return sum(s.sum for _, s in stats)
        case "avg":
            n = sum(s.n for _, s in stats)
            return sum(s.sum for _, s in stats) / n if n else None
        case "min":
            return min(s.min for _, s in stats)
        case "max":
            return max(s.max for _, s in stats)
        case "last":
            return max(stats, key=lambda x: x[0])[1].avg
        case "count":
            return float(len(stats))
    return None
