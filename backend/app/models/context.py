"""CONTEXTUAL DATA — Crop Year, safra, turno, produto, lote.

Crop Year e safra são entidades com data inicial/final: nada assume ano civil.
"""
from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class CropYear(Base):
    __tablename__ = "crop_year"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(60))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)


class Season(Base):
    """Safra (ex.: Safra Verão 2026, Safrinha 2026)."""

    __tablename__ = "season"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(60))
    season_type: Mapped[str] = mapped_column(String(30))  # verao | safrinha | inverno | ...
    crop_year_id: Mapped[int | None] = mapped_column(ForeignKey("crop_year.id"))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    crop_year: Mapped[CropYear | None] = relationship()


class Shift(Base):
    __tablename__ = "shift"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)


class Product(Base):
    __tablename__ = "product"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    crop: Mapped[str] = mapped_column(String(40), default="milho")


class Batch(Base):
    """Lote de produção — permite indicadores por lote (kWh/lote)."""

    __tablename__ = "batch"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("product.id"))
    node_id: Mapped[int] = mapped_column(ForeignKey("hierarchy_node.id"), index=True)
    season_id: Mapped[int | None] = mapped_column(ForeignKey("season.id"))
    start_ts: Mapped[datetime] = mapped_column(DateTime, index=True)
    end_ts: Mapped[datetime | None] = mapped_column(DateTime)
    quantity_t: Mapped[float | None] = mapped_column(Float)
    moisture_in_pct: Mapped[float | None] = mapped_column(Float)
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shift.id"))
    notes: Mapped[str | None] = mapped_column(Text)

    product: Mapped[Product | None] = relationship()
