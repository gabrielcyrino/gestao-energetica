"""Oportunidades de melhoria, usuários/perfis e trilha de auditoria."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.master import JSONType, Person, TimestampMixin


class Opportunity(TimestampMixin, Base):
    __tablename__ = "opportunity"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    node_id: Mapped[int] = mapped_column(ForeignKey("hierarchy_node.id"), index=True)
    use_id: Mapped[int | None] = mapped_column(ForeignKey("significant_energy_use.id"))
    equipment_id: Mapped[int | None] = mapped_column(ForeignKey("equipment.id"))
    indicator_id: Mapped[int | None] = mapped_column(ForeignKey("indicator.id"))
    problem: Mapped[str] = mapped_column(Text)
    opportunity: Mapped[str] = mapped_column(Text)
    reference_consumption: Mapped[float | None] = mapped_column(Float)
    reference_unit: Mapped[str | None] = mapped_column(String(32))
    estimated_savings_mwh_year: Mapped[float | None] = mapped_column(Float)
    estimated_savings_brl_year: Mapped[float | None] = mapped_column(Float)
    estimated_investment_brl: Mapped[float | None] = mapped_column(Float)
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("person.id"))
    priority: Mapped[str] = mapped_column(String(10), default="media")  # alta | media | baixa
    # identificada | em_analise | aprovada | em_implementacao | implementada | verificada | cancelada
    status: Mapped[str] = mapped_column(String(20), default="identificada")
    due_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    # Retrato do desvio que originou a oportunidade (valor, meta, período, status no momento).
    deviation_snapshot: Mapped[dict | None] = mapped_column(JSONType)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))

    responsible: Mapped[Person | None] = relationship()


class AppUser(Base):
    __tablename__ = "app_user"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(200))  # None quando autenticado via IdP (OIDC)
    role: Mapped[str] = mapped_column(String(30))  # admin | energy_manager | process_owner | viewer
    person_id: Mapped[int | None] = mapped_column(ForeignKey("person.id"))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class UserNodeScope(Base):
    """Segregação de acesso: dono de processo só edita dentro dos nós atribuídos (e descendentes)."""

    __tablename__ = "user_node_scope"
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True)
    node_id: Mapped[int] = mapped_column(ForeignKey("hierarchy_node.id", ondelete="CASCADE"), primary_key=True)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    username: Mapped[str | None] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(20))  # create | update | delete | login | ingest | fit
    entity: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(String(60))
    before: Mapped[dict | None] = mapped_column(JSONType)
    after: Mapped[dict | None] = mapped_column(JSONType)
    ip: Mapped[str | None] = mapped_column(String(60))
    request_id: Mapped[str | None] = mapped_column(String(60))
