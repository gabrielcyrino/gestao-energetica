"""MASTER DATA — estrutura física, USEs, equipamentos, variáveis, indicadores, metas e baselines.

Toda a hierarquia é configurável (tabela auto-relacionada + níveis cadastráveis):
nada de Recebimento/Torre está no código — está nos dados.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# --------------------------------------------------------------------------- catálogos
class Unit(Base):
    """Unidade de medida. Conversões só entre unidades da mesma grandeza (quantity)."""

    __tablename__ = "unit"
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    quantity: Mapped[str] = mapped_column(String(40))  # energy, mass, time, power, ratio, ...
    factor_to_base: Mapped[float] = mapped_column(Float, default=1.0)  # valor_base = valor * fator + offset
    offset_to_base: Mapped[float] = mapped_column(Float, default=0.0)


class EnergyCarrier(Base):
    """Fonte/vetor energético. kind=boundary entra pela fronteira da planta (comprada);
    kind=internal é energia secundária gerada internamente (vapor, ar comprimido) e NÃO é
    somada nos totais da planta, evitando dupla contagem."""

    __tablename__ = "energy_carrier"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20), default="boundary")  # boundary | internal
    unit_id: Mapped[int] = mapped_column(ForeignKey("unit.id"))
    # Conteúdo energético por unidade física, em kWh (ex.: cavaco 11 GJ/t -> 3055,6 kWh/t).
    kwh_per_unit: Mapped[float] = mapped_column(Float, default=1.0)
    color_slot: Mapped[int] = mapped_column(Integer, default=1)
    description: Mapped[str | None] = mapped_column(Text)

    unit: Mapped[Unit] = relationship()


class UseCategory(Base):
    __tablename__ = "use_category"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    icon: Mapped[str | None] = mapped_column(String(40))
    color_slot: Mapped[int] = mapped_column(Integer, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(Text)


class DataSource(Base):
    __tablename__ = "data_source"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(30))  # historian, scada, meter, iot, mes, erp, manual, csv, calculated
    protocol: Mapped[str | None] = mapped_column(String(60))
    is_automatic: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str | None] = mapped_column(Text)


class Person(Base):
    """Responsáveis (donos de processo, gestão de energia...)."""

    __tablename__ = "person"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    role_title: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(160))


# --------------------------------------------------------------------------- hierarquia
class HierarchyLevel(Base):
    """Níveis da hierarquia (empresa, planta, área, processo, subprocesso...). Cadastráveis."""

    __tablename__ = "hierarchy_level"
    code: Mapped[str] = mapped_column(String(30), primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    depth: Mapped[int] = mapped_column(Integer)
    has_flow: Mapped[bool] = mapped_column(Boolean, default=False)  # nível possui fluxograma próprio
    allows_uses: Mapped[bool] = mapped_column(Boolean, default=False)


class HierarchyNode(TimestampMixin, Base):
    __tablename__ = "hierarchy_node"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    level: Mapped[str] = mapped_column(ForeignKey("hierarchy_level.code"))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("hierarchy_node.id"))
    path: Mapped[str] = mapped_column(String(400), default="/", index=True)  # "/1/2/5/" (ltree em produção)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("person.id"))
    color_slot: Mapped[int | None] = mapped_column(Integer)
    # Variável de produção de referência para intensidade energética do nó (ex.: t processadas).
    production_variable_id: Mapped[int | None] = mapped_column(
        ForeignKey("variable.id", use_alter=True, name="fk_node_prod_var")
    )
    operating_regime: Mapped[str | None] = mapped_column(String(40))
    attributes: Mapped[dict] = mapped_column(JSONType, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    parent: Mapped[HierarchyNode | None] = relationship(remote_side="HierarchyNode.id", back_populates="children")
    children: Mapped[list[HierarchyNode]] = relationship(back_populates="parent", order_by="HierarchyNode.sort_order")
    owner: Mapped[Person | None] = relationship()


class FlowNode(Base):
    """Nó do fluxograma pertencente ao diagrama de um nó da hierarquia (tipicamente a área)."""

    __tablename__ = "flow_node"
    id: Mapped[int] = mapped_column(primary_key=True)
    diagram_node_id: Mapped[int] = mapped_column(ForeignKey("hierarchy_node.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # process | input | output | storage | utility | link
    label: Mapped[str] = mapped_column(String(120))
    hierarchy_node_id: Mapped[int | None] = mapped_column(ForeignKey("hierarchy_node.id", ondelete="CASCADE"))
    linked_node_id: Mapped[int | None] = mapped_column(ForeignKey("hierarchy_node.id"))  # ex.: saída -> Torre
    pos_x: Mapped[float | None] = mapped_column(Float)
    pos_y: Mapped[float | None] = mapped_column(Float)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class FlowEdge(Base):
    __tablename__ = "flow_edge"
    id: Mapped[int] = mapped_column(primary_key=True)
    diagram_node_id: Mapped[int] = mapped_column(ForeignKey("hierarchy_node.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("flow_node.id", ondelete="CASCADE"))
    target_id: Mapped[int] = mapped_column(ForeignKey("flow_node.id", ondelete="CASCADE"))
    stream_type: Mapped[str] = mapped_column(String(20), default="material")  # material | energy | residue
    label: Mapped[str | None] = mapped_column(String(80))
    energy_carrier_id: Mapped[int | None] = mapped_column(ForeignKey("energy_carrier.id"))


# --------------------------------------------------------------------------- USE / equipamento
class SignificantEnergyUse(TimestampMixin, Base):
    """USE — Uso Significativo de Energia presente em um processo/subprocesso."""

    __tablename__ = "significant_energy_use"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    category_id: Mapped[int] = mapped_column(ForeignKey("use_category.id"))
    node_id: Mapped[int] = mapped_column(ForeignKey("hierarchy_node.id"), index=True)
    energy_carrier_id: Mapped[int] = mapped_column(ForeignKey("energy_carrier.id"))
    description: Mapped[str | None] = mapped_column(Text)
    # continuous_24x7 | intermittent | batch | seasonal
    operating_regime: Mapped[str] = mapped_column(String(30), default="intermittent")
    operating_period: Mapped[str | None] = mapped_column(String(160))
    significance_reason: Mapped[str | None] = mapped_column(Text)
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("person.id"))
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped[UseCategory] = relationship()
    node: Mapped[HierarchyNode] = relationship()
    energy_carrier: Mapped[EnergyCarrier] = relationship()
    responsible: Mapped[Person | None] = relationship()
    equipment: Mapped[list[Equipment]] = relationship(back_populates="use", order_by="Equipment.tag")
    relevant_variables: Mapped[list[UseRelevantVariable]] = relationship(cascade="all, delete-orphan")


class UseRelevantVariable(Base):
    """Variáveis relevantes que explicam o consumo do USE (produção, umidade, temperatura...)."""

    __tablename__ = "use_relevant_variable"
    use_id: Mapped[int] = mapped_column(ForeignKey("significant_energy_use.id", ondelete="CASCADE"), primary_key=True)
    variable_id: Mapped[int] = mapped_column(ForeignKey("variable.id", ondelete="CASCADE"), primary_key=True)
    rationale: Mapped[str | None] = mapped_column(Text)

    variable: Mapped[Variable] = relationship()


class Equipment(TimestampMixin, Base):
    __tablename__ = "equipment"
    id: Mapped[int] = mapped_column(primary_key=True)
    tag: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    use_id: Mapped[int] = mapped_column(ForeignKey("significant_energy_use.id"), index=True)
    equipment_type: Mapped[str] = mapped_column(String(80))
    manufacturer: Mapped[str | None] = mapped_column(String(80))
    model: Mapped[str | None] = mapped_column(String(80))
    rated_power_kw: Mapped[float | None] = mapped_column(Float)
    rated_efficiency_pct: Mapped[float | None] = mapped_column(Float)
    efficiency_class: Mapped[str | None] = mapped_column(String(20))
    has_vfd: Mapped[bool] = mapped_column(Boolean, default=False)
    commissioning_year: Mapped[int | None] = mapped_column(Integer)
    # Dados de placa específicos do tipo (tensão, corrente, capacidade t/h, pressão...).
    attributes: Mapped[dict] = mapped_column(JSONType, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    use: Mapped[SignificantEnergyUse] = relationship(back_populates="equipment")


class Variable(TimestampMixin, Base):
    """Sensor/tag/variável. Energia, produção, estados operacionais e condições de processo
    compartilham o mesmo modelo de série temporal."""

    __tablename__ = "variable"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    # energy | production | operational | electrical | process_condition | context
    variable_type: Mapped[str] = mapped_column(String(30))
    unit_id: Mapped[int] = mapped_column(ForeignKey("unit.id"))
    node_id: Mapped[int | None] = mapped_column(ForeignKey("hierarchy_node.id"), index=True)
    equipment_id: Mapped[int | None] = mapped_column(ForeignKey("equipment.id"), index=True)
    energy_carrier_id: Mapped[int | None] = mapped_column(ForeignKey("energy_carrier.id"))
    data_source_id: Mapped[int | None] = mapped_column(ForeignKey("data_source.id"))
    source_tag: Mapped[str | None] = mapped_column(String(160))  # tag no historiador/SCADA
    collection_frequency: Mapped[str] = mapped_column(String(20), default="1d")
    is_automatic: Mapped[bool] = mapped_column(Boolean, default=True)
    measurement_method: Mapped[str] = mapped_column(String(20), default="measured")  # measured | estimated | calculated
    aggregation: Mapped[str] = mapped_column(String(10), default="sum")  # sum | avg | min | max | last
    # Energia que compõe o total do nó (evita dupla contagem medidor geral x submedidores).
    counts_toward_total: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)

    unit: Mapped[Unit] = relationship()
    equipment: Mapped[Equipment | None] = relationship()
    node: Mapped[HierarchyNode | None] = relationship(foreign_keys=[node_id])
    energy_carrier: Mapped[EnergyCarrier | None] = relationship()
    data_source: Mapped[DataSource | None] = relationship()


# --------------------------------------------------------------------------- indicadores
class IndicatorTemplate(Base):
    """Catálogo de referência (planilha USE x indicadores intrínsecos) usado para instanciar IDEs."""

    __tablename__ = "indicator_template"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    use_category_id: Mapped[int | None] = mapped_column(ForeignKey("use_category.id"))
    kind: Mapped[str] = mapped_column(String(20))  # intrinsic | extrinsic
    formula: Mapped[str] = mapped_column(String(400))
    symbols: Mapped[dict] = mapped_column(JSONType, default=dict)  # {"E": "energia ativa (kWh)", ...}
    unit_symbol: Mapped[str] = mapped_column(String(32))
    direction: Mapped[str] = mapped_column(String(20), default="lower_better")
    description: Mapped[str | None] = mapped_column(Text)


class Indicator(TimestampMixin, Base):
    """IDE — Indicador de Desempenho Energético configurável (fórmula + variáveis ligadas)."""

    __tablename__ = "indicator"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20))  # intrinsic | extrinsic
    category: Mapped[str] = mapped_column(String(40), default="intensidade")
    template_id: Mapped[int | None] = mapped_column(ForeignKey("indicator_template.id"))
    node_id: Mapped[int] = mapped_column(ForeignKey("hierarchy_node.id"), index=True)
    use_id: Mapped[int | None] = mapped_column(ForeignKey("significant_energy_use.id"), index=True)
    equipment_id: Mapped[int | None] = mapped_column(ForeignKey("equipment.id"), index=True)
    formula: Mapped[str] = mapped_column(String(400))
    unit_id: Mapped[int] = mapped_column(ForeignKey("unit.id"))
    frequency: Mapped[str] = mapped_column(String(20), default="1d")
    # lower_better | higher_better | target_range | none
    direction: Mapped[str] = mapped_column(String(20), default="lower_better")
    decimals: Mapped[int] = mapped_column(Integer, default=2)
    # Regra de status configurável por indicador (sem limites universais):
    # {"basis": "target"|"baseline", "tolerance_pct": 2, "critical_pct": 10}
    status_rule: Mapped[dict] = mapped_column(JSONType, default=dict)
    upper_limit: Mapped[float | None] = mapped_column(Float)  # limites operacionais absolutos
    lower_limit: Mapped[float | None] = mapped_column(Float)
    min_completeness_pct: Mapped[float] = mapped_column(Float, default=80.0)
    # Quando definido, completude e série diária consideram apenas dias em que esta variável > 0
    # (ex.: horas em operação). Dia sem operação não é "dado ausente".
    operating_variable_id: Mapped[int | None] = mapped_column(ForeignKey("variable.id"))
    stability_band_pct: Mapped[float] = mapped_column(Float, default=3.0)
    baseline_model_id: Mapped[int | None] = mapped_column(
        ForeignKey("energy_baseline.id", use_alter=True, name="fk_indicator_baseline_model")
    )
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("person.id"))
    data_origin_note: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    unit: Mapped[Unit] = relationship()
    node: Mapped[HierarchyNode] = relationship()
    use: Mapped[SignificantEnergyUse | None] = relationship()
    equipment: Mapped[Equipment | None] = relationship()
    responsible: Mapped[Person | None] = relationship()
    bindings: Mapped[list[IndicatorBinding]] = relationship(
        back_populates="indicator", cascade="all, delete-orphan", order_by="IndicatorBinding.symbol"
    )
    targets: Mapped[list[IndicatorTarget]] = relationship(
        back_populates="indicator", cascade="all, delete-orphan", order_by="IndicatorTarget.valid_from"
    )


class IndicatorBinding(Base):
    """Liga um símbolo da fórmula a uma fonte de valor:
    - variable: variável/tag agregada no período (sum/avg/min/max/last/count)
    - constant: valor fixo (ex.: entalpia do vapor)
    - equipment_attribute: dado de placa (ex.: potência nominal)
    - builtin: PERIOD_HOURS, PERIOD_DAYS, DATA_DAYS"""

    __tablename__ = "indicator_binding"
    __table_args__ = (UniqueConstraint("indicator_id", "symbol"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    indicator_id: Mapped[int] = mapped_column(ForeignKey("indicator.id", ondelete="CASCADE"))
    symbol: Mapped[str] = mapped_column(String(30))
    source_type: Mapped[str] = mapped_column(String(30), default="variable")
    variable_id: Mapped[int | None] = mapped_column(ForeignKey("variable.id"))
    aggregation: Mapped[str | None] = mapped_column(String(10))  # sobrescreve a agregação padrão da variável
    unit_id: Mapped[int | None] = mapped_column(ForeignKey("unit.id"))  # converte para esta unidade antes da fórmula
    constant_value: Mapped[float | None] = mapped_column(Float)
    attribute: Mapped[str | None] = mapped_column(String(60))
    builtin: Mapped[str | None] = mapped_column(String(30))

    indicator: Mapped[Indicator] = relationship(back_populates="bindings")
    variable: Mapped[Variable | None] = relationship()
    unit: Mapped[Unit | None] = relationship()


class IndicatorTarget(Base):
    """Metas versionadas no tempo (ex.: revisão a cada Crop Year) e por escopo (anual × janela de safra).

    Em operação sazonal, a intensidade de uma safrinha de baixo volume não deve ser julgada pela média anual:
    períodos curtos usam a meta da janela de safra; períodos longos, a meta anual."""

    __tablename__ = "indicator_target"
    id: Mapped[int] = mapped_column(primary_key=True)
    indicator_id: Mapped[int] = mapped_column(ForeignKey("indicator.id", ondelete="CASCADE"), index=True)
    valid_from: Mapped[date] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    target_value: Mapped[float | None] = mapped_column(Float)
    target_min: Mapped[float | None] = mapped_column(Float)
    target_max: Mapped[float | None] = mapped_column(Float)
    baseline_value: Mapped[float | None] = mapped_column(Float)
    # all: vale para qualquer período | annual: períodos longos (ano, Crop Year) | seasonal: janela de safra
    scope: Mapped[str] = mapped_column(String(20), default="all")
    label: Mapped[str | None] = mapped_column(String(80))
    justification: Mapped[str | None] = mapped_column(Text)

    indicator: Mapped[Indicator] = relationship(back_populates="targets")


class EnergyBaseline(TimestampMixin, Base):
    """Linha de base energética (ISO 50001/50006 como referência).
    model_type: fixed | regression. Para regressão:
    consumo_esperado = intercept + Σ coef_i * variável_relevante_i (por dia de operação)."""

    __tablename__ = "energy_baseline"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    scope_level: Mapped[str] = mapped_column(String(20))  # node | use | equipment
    node_id: Mapped[int | None] = mapped_column(ForeignKey("hierarchy_node.id"))
    use_id: Mapped[int | None] = mapped_column(ForeignKey("significant_energy_use.id"))
    equipment_id: Mapped[int | None] = mapped_column(ForeignKey("equipment.id"))
    energy_variable_id: Mapped[int] = mapped_column(ForeignKey("variable.id"))
    model_type: Mapped[str] = mapped_column(String(20), default="regression")
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    # {"intercept": .., "coefficients": {"W": ..}, "variables": {"W": var_id}, "r2": .., "cv_rmse_pct": .., "n": ..}
    model: Mapped[dict] = mapped_column(JSONType, default=dict)
    operating_filter_variable_id: Mapped[int | None] = mapped_column(ForeignKey("variable.id"))
    status: Mapped[str] = mapped_column(String(20), default="active")  # draft | active | superseded
    notes: Mapped[str | None] = mapped_column(Text)
