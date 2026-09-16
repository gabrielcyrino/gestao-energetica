"""Modelos de entrada (validação) da API."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Direction = Literal["lower_better", "higher_better", "target_range", "none"]
Aggregation = Literal["sum", "avg", "min", "max", "last", "count"]


class LoginIn(BaseModel):
    username: str
    password: str


class NodeIn(BaseModel):
    code: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    name: str = Field(min_length=2, max_length=120)
    level: str
    parent_id: int | None = None
    sort_order: int = 0
    description: str | None = None
    owner_id: int | None = None
    color_slot: int | None = Field(default=None, ge=1, le=8)
    production_variable_id: int | None = None
    operating_regime: str | None = None
    active: bool = True


class FlowNodeIn(BaseModel):
    id: int | None = None
    key: str | None = None  # referência temporária para arestas de nós novos
    kind: Literal["process", "input", "output", "storage", "utility", "link"]
    label: str
    hierarchy_node_id: int | None = None
    linked_node_id: int | None = None
    pos_x: float | None = None
    pos_y: float | None = None


class FlowEdgeIn(BaseModel):
    source: str  # id existente (como texto) ou key temporária
    target: str
    stream_type: Literal["material", "energy", "residue"] = "material"
    label: str | None = None
    energy_carrier_id: int | None = None


class FlowIn(BaseModel):
    nodes: list[FlowNodeIn]
    edges: list[FlowEdgeIn]


class UseIn(BaseModel):
    code: str = Field(min_length=2, max_length=60)
    name: str = Field(min_length=2, max_length=120)
    category_id: int
    node_id: int
    energy_carrier_id: int
    description: str | None = None
    operating_regime: Literal["continuous_24x7", "intermittent", "batch", "seasonal"] = "intermittent"
    operating_period: str | None = None
    significance_reason: str | None = None
    responsible_id: int | None = None
    active: bool = True


class EquipmentIn(BaseModel):
    tag: str = Field(min_length=2, max_length=60)
    name: str = Field(min_length=2, max_length=120)
    use_id: int
    equipment_type: str
    manufacturer: str | None = None
    model: str | None = None
    rated_power_kw: float | None = Field(default=None, ge=0)
    rated_efficiency_pct: float | None = Field(default=None, gt=0, le=100)
    efficiency_class: str | None = None
    has_vfd: bool = False
    commissioning_year: int | None = Field(default=None, ge=1950, le=2100)
    attributes: dict = Field(default_factory=dict)
    active: bool = True


class VariableIn(BaseModel):
    code: str = Field(min_length=2, max_length=80)
    name: str
    variable_type: Literal["energy", "energy_state", "production", "operational", "electrical", "process_condition", "context"]
    unit_id: int
    node_id: int | None = None
    equipment_id: int | None = None
    energy_carrier_id: int | None = None
    data_source_id: int | None = None
    source_tag: str | None = None
    collection_frequency: str = "1d"
    is_automatic: bool = True
    measurement_method: Literal["measured", "estimated", "calculated"] = "measured"
    aggregation: Aggregation = "sum"
    counts_toward_total: bool = False
    notes: str | None = None


class BindingIn(BaseModel):
    symbol: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,29}$")
    source_type: Literal["variable", "constant", "equipment_attribute", "builtin"] = "variable"
    variable_id: int | None = None
    aggregation: Aggregation | None = None
    unit_id: int | None = None
    constant_value: float | None = None
    attribute: str | None = None
    builtin: Literal["PERIOD_DAYS", "PERIOD_HOURS"] | None = None


class TargetIn(BaseModel):
    valid_from: date
    valid_to: date | None = None
    target_value: float | None = None
    target_min: float | None = None
    target_max: float | None = None
    baseline_value: float | None = None
    scope: Literal["all", "annual", "seasonal"] = "all"
    label: str | None = None
    justification: str | None = None


class StatusRuleIn(BaseModel):
    basis: Literal["target", "baseline"] = "target"
    tolerance_pct: float = Field(default=4.0, ge=0)
    critical_pct: float = Field(default=10.0, ge=0)


class IndicatorIn(BaseModel):
    code: str = Field(min_length=3, max_length=60)
    name: str = Field(min_length=3, max_length=160)
    description: str | None = None
    kind: Literal["intrinsic", "extrinsic"]
    category: str = "intensidade"
    template_id: int | None = None
    node_id: int
    use_id: int | None = None
    equipment_id: int | None = None
    formula: str = Field(min_length=1, max_length=400)
    unit_id: int
    frequency: str = "1d"
    direction: Direction = "lower_better"
    decimals: int = Field(default=2, ge=0, le=6)
    status_rule: StatusRuleIn = Field(default_factory=StatusRuleIn)
    upper_limit: float | None = None
    lower_limit: float | None = None
    min_completeness_pct: float = Field(default=80.0, ge=0, le=100)
    operating_variable_id: int | None = None
    stability_band_pct: float = Field(default=3.0, ge=0)
    baseline_model_id: int | None = None
    responsible_id: int | None = None
    data_origin_note: str | None = None
    active: bool = True
    bindings: list[BindingIn] = Field(default_factory=list)
    targets: list[TargetIn] = Field(default_factory=list)

    @field_validator("bindings")
    @classmethod
    def unique_symbols(cls, v: list[BindingIn]):
        symbols = [b.symbol for b in v]
        if len(symbols) != len(set(symbols)):
            raise ValueError("Símbolos duplicados nos vínculos.")
        return v


class FormulaCheckIn(BaseModel):
    formula: str
    bindings: list[BindingIn] = Field(default_factory=list)


class PreviewIn(IndicatorIn):
    code: str = "PREVIEW"
    name: str = "Pré-visualização"
    period: str | None = None


class CropYearIn(BaseModel):
    code: str = Field(min_length=2, max_length=20)
    name: str
    start_date: date
    end_date: date
    notes: str | None = None


class SeasonIn(BaseModel):
    code: str = Field(min_length=2, max_length=20)
    name: str
    season_type: str
    crop_year_id: int | None = None
    start_date: date
    end_date: date
    notes: str | None = None


class OpportunityIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    node_id: int
    use_id: int | None = None
    equipment_id: int | None = None
    indicator_id: int | None = None
    problem: str
    opportunity: str
    reference_consumption: float | None = None
    reference_unit: str | None = None
    estimated_savings_mwh_year: float | None = Field(default=None, ge=0)
    estimated_savings_brl_year: float | None = Field(default=None, ge=0)
    estimated_investment_brl: float | None = Field(default=None, ge=0)
    responsible_id: int | None = None
    priority: Literal["alta", "media", "baixa"] = "media"
    status: Literal["identificada", "em_analise", "aprovada", "em_implementacao", "implementada", "verificada",
                    "cancelada"] = "identificada"
    due_date: date | None = None
    notes: str | None = None
    deviation_snapshot: dict | None = None


class BaselineFitIn(BaseModel):
    variables: dict[str, int] | None = None
    period_start: date | None = None
    period_end: date | None = None


class MeasurementIn(BaseModel):
    variable_code: str
    ts: str
    value: float | None
    quality: Literal["good", "suspect", "bad", "estimated", "manual"] = "good"


class MeasurementBatchIn(BaseModel):
    source: str = "api"
    measurements: list[MeasurementIn] = Field(max_length=50000)
