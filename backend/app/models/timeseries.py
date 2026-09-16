"""TIME SERIES DATA — medições, valores de indicadores e eventos operacionais.

Em PostgreSQL + TimescaleDB, `measurement` e `indicator_value` viram hypertables
(ver db/timescale/001_hypertables.sql) com agregados contínuos diários/semanais.
Dado ausente = linha ausente (ou quality='bad' com value NULL). Nunca zero implícito.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.master import JSONType


class Measurement(Base):
    __tablename__ = "measurement"
    variable_id: Mapped[int] = mapped_column(ForeignKey("variable.id", ondelete="CASCADE"), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
    value: Mapped[float | None] = mapped_column(Float)
    quality: Mapped[str] = mapped_column(String(12), default="good")  # good | suspect | bad | estimated | manual
    source: Mapped[str] = mapped_column(String(20), default="historian")
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("ingestion_batch.id"))
    ingested_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class IndicatorValue(Base):
    """Valores materializados pelo worker de cálculo (alarmes, exportação para BI, histórico congelado)."""

    __tablename__ = "indicator_value"
    indicator_id: Mapped[int] = mapped_column(ForeignKey("indicator.id", ondelete="CASCADE"), primary_key=True)
    grain: Mapped[str] = mapped_column(String(10), primary_key=True)  # day | week | month
    period_start: Mapped[date] = mapped_column(Date, primary_key=True)
    value: Mapped[float | None] = mapped_column(Float)
    completeness_pct: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(20))
    components: Mapped[dict] = mapped_column(JSONType, default=dict)  # valores agregados dos símbolos
    computed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class OperationalEvent(Base):
    """Estados/eventos operacionais com duração: parada, manutenção, setup, falta de produto..."""

    __tablename__ = "operational_event"
    id: Mapped[int] = mapped_column(primary_key=True)
    node_id: Mapped[int | None] = mapped_column(ForeignKey("hierarchy_node.id"), index=True)
    equipment_id: Mapped[int | None] = mapped_column(ForeignKey("equipment.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(30))  # parada | manutencao | setup | sem_produto | intervencao
    ts_start: Mapped[datetime] = mapped_column(DateTime, index=True)
    ts_end: Mapped[datetime | None] = mapped_column(DateTime)
    description: Mapped[str | None] = mapped_column(Text)


class IngestionBatch(Base):
    __tablename__ = "ingestion_batch"
    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(40))  # csv | api | opcua-gateway | mqtt-bridge | mock
    filename: Mapped[str | None] = mapped_column(String(200))
    received_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    rows_total: Mapped[int] = mapped_column(Integer, default=0)
    rows_ok: Mapped[int] = mapped_column(Integer, default=0)
    rows_rejected: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[list] = mapped_column(JSONType, default=list)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
