"""Autenticação, metadados, períodos, catálogos configuráveis e auditoria."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.common import get_or_404, row_to_dict
from app.api.schemas import CropYearIn, LoginIn, SeasonIn
from app.config import get_settings
from app.db import get_db
from app.engine.formula import FUNCTIONS
from app.engine.indicators import AGGREGATIONS, BUILTINS
from app.engine.periods import PeriodError
from app.engine.repository import cache
from app.engine.status import STATUS_LABELS
from app.models import (
    AppUser,
    AuditLog,
    CropYear,
    DataSource,
    EnergyCarrier,
    HierarchyLevel,
    IndicatorTemplate,
    Person,
    Season,
    Unit,
    UseCategory,
)
from app.security import (
    EDITORS,
    ROLES,
    audit,
    create_token,
    get_current_user,
    require_roles,
    user_scope_paths,
    verify_password,
)
from app.services.context import period_context

router = APIRouter()


# ---------------------------------------------------------------------- auth
@router.post("/auth/login", tags=["Autenticação"])
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(AppUser).where(AppUser.username == body.username))
    if user is None or not user.active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Usuário ou senha inválidos.")
    audit(db, user, "login", "app_user", user.id, request=request)
    db.commit()
    return {"access_token": create_token(user), "token_type": "bearer", "user": _user_out(db, user)}


@router.get("/auth/me", tags=["Autenticação"])
def me(user: AppUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return _user_out(db, user)


@router.get("/auth/demo-users", tags=["Autenticação"])
def demo_users(db: Session = Depends(get_db)):
    if not get_settings().demo_auth:
        raise HTTPException(404, "Indisponível fora do modo DEMO.")
    return [
        {"username": u.username, "display_name": u.display_name, "role": u.role, "role_label": ROLES[u.role]}
        for u in db.scalars(select(AppUser).where(AppUser.active.is_(True)).order_by(AppUser.id))
    ]


def _user_out(db: Session, user: AppUser) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "role_label": ROLES.get(user.role, user.role),
        "can_edit_master_data": user.role in EDITORS,
        "scope_paths": user_scope_paths(db, user),
    }


# ---------------------------------------------------------------------- meta
@router.get("/meta", tags=["Metadados"])
def meta(db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    s = get_settings()
    ctx = period_context(db)
    return {
        "app_name": s.app_name,
        "environment": s.environment,
        "demo": s.environment == "demo",
        "data_notice": "DEMO / MOCK DATA — dados fictícios gerados por simulação; não representam a operação real.",
        "reference_energy_unit": s.reference_energy_unit,
        "periods": ctx.options(),
        "statuses": [{"code": k, "label": v} for k, v in STATUS_LABELS.items()],
        "levels": [row_to_dict(x) for x in db.scalars(select(HierarchyLevel).order_by(HierarchyLevel.depth))],
        "carriers": [row_to_dict(x) for x in db.scalars(select(EnergyCarrier).order_by(EnergyCarrier.color_slot))],
        "use_categories": [row_to_dict(x) for x in db.scalars(select(UseCategory).order_by(UseCategory.sort_order))],
        "units": [row_to_dict(x) for x in db.scalars(select(Unit).order_by(Unit.quantity, Unit.symbol))],
        "data_sources": [row_to_dict(x) for x in db.scalars(select(DataSource))],
        "people": [row_to_dict(x) for x in db.scalars(select(Person).order_by(Person.name))],
        "formula": {
            "functions": {k: v[1] for k, v in FUNCTIONS.items()},
            "builtins": BUILTINS,
            "aggregations": sorted(AGGREGATIONS),
            "operators": ["+", "-", "*", "/", "^", "( )", "<", ">", "<=", ">=", "==", "!="],
        },
        "roles": ROLES,
    }


# ---------------------------------------------------------------------- períodos
@router.get("/periods/options", tags=["Períodos"])
def period_options(db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    return period_context(db).options()


@router.get("/periods/resolve", tags=["Períodos"])
def period_resolve(spec: str, compare: str | None = None, db: Session = Depends(get_db),
                   _: AppUser = Depends(get_current_user)):
    ctx = period_context(db)
    try:
        a = ctx.resolve(spec)
        b = ctx.comparison(a, compare)
    except PeriodError as exc:
        raise HTTPException(422, str(exc)) from None
    return {"current": a.to_dict(), "previous": b.to_dict()}


def _create_range(db: Session, user: AppUser, request: Request, model, data: dict):
    if data["end_date"] < data["start_date"]:
        raise HTTPException(422, "Data final anterior à inicial.")
    obj = model(**data)
    db.add(obj)
    _commit(db)
    audit(db, user, "create", model.__tablename__, obj.id, after=row_to_dict(obj), request=request)
    db.commit()
    cache.invalidate()
    return row_to_dict(obj)


def _update_range(db: Session, user: AppUser, request: Request, model, item_id: int, data: dict, name: str):
    obj = get_or_404(db, model, item_id, name)
    before = row_to_dict(obj)
    if data["end_date"] < data["start_date"]:
        raise HTTPException(422, "Data final anterior à inicial.")
    for k, v in data.items():
        setattr(obj, k, v)
    _commit(db)
    audit(db, user, "update", model.__tablename__, obj.id, before, row_to_dict(obj), request)
    db.commit()
    cache.invalidate()
    return row_to_dict(obj)


def _delete_range(db: Session, user: AppUser, request: Request, model, item_id: int, name: str):
    obj = get_or_404(db, model, item_id, name)
    audit(db, user, "delete", model.__tablename__, obj.id, row_to_dict(obj), None, request)
    db.delete(obj)
    _commit(db)
    cache.invalidate()


@router.get("/periods/crop-years", tags=["Períodos"])
def list_crop_years(db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    return [row_to_dict(x) for x in db.scalars(select(CropYear).order_by(CropYear.start_date))]


@router.post("/periods/crop-years", tags=["Períodos"], status_code=201)
def create_crop_year(body: CropYearIn, request: Request, db: Session = Depends(get_db),
                     user: AppUser = Depends(require_roles(*EDITORS))):
    return _create_range(db, user, request, CropYear, body.model_dump())


@router.put("/periods/crop-years/{item_id}", tags=["Períodos"])
def update_crop_year(item_id: int, body: CropYearIn, request: Request, db: Session = Depends(get_db),
                     user: AppUser = Depends(require_roles(*EDITORS))):
    return _update_range(db, user, request, CropYear, item_id, body.model_dump(), "Crop Year")


@router.delete("/periods/crop-years/{item_id}", tags=["Períodos"], status_code=204)
def delete_crop_year(item_id: int, request: Request, db: Session = Depends(get_db),
                     user: AppUser = Depends(require_roles(*EDITORS))):
    _delete_range(db, user, request, CropYear, item_id, "Crop Year")


@router.get("/periods/seasons", tags=["Períodos"])
def list_seasons(db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    return [row_to_dict(x) for x in db.scalars(select(Season).order_by(Season.start_date))]


@router.post("/periods/seasons", tags=["Períodos"], status_code=201)
def create_season(body: SeasonIn, request: Request, db: Session = Depends(get_db),
                  user: AppUser = Depends(require_roles(*EDITORS))):
    return _create_range(db, user, request, Season, body.model_dump())


@router.put("/periods/seasons/{item_id}", tags=["Períodos"])
def update_season(item_id: int, body: SeasonIn, request: Request, db: Session = Depends(get_db),
                  user: AppUser = Depends(require_roles(*EDITORS))):
    return _update_range(db, user, request, Season, item_id, body.model_dump(), "Safra")


@router.delete("/periods/seasons/{item_id}", tags=["Períodos"], status_code=204)
def delete_season(item_id: int, request: Request, db: Session = Depends(get_db),
                  user: AppUser = Depends(require_roles(*EDITORS))):
    _delete_range(db, user, request, Season, item_id, "Safra")





# ---------------------------------------------------------------------- catálogos genéricos
CATALOGS = {
    "units": (Unit, {"symbol", "name", "quantity", "factor_to_base", "offset_to_base"}),
    "energy-carriers": (EnergyCarrier, {"code", "name", "kind", "unit_id", "kwh_per_unit", "color_slot", "description"}),
    "use-categories": (UseCategory, {"code", "name", "icon", "color_slot", "sort_order", "description"}),
    "data-sources": (DataSource, {"code", "name", "kind", "protocol", "is_automatic", "description"}),
    "people": (Person, {"name", "role_title", "email"}),
    "indicator-templates": (IndicatorTemplate, {"code", "name", "use_category_id", "kind", "formula", "symbols",
                                                "unit_symbol", "direction", "description"}),
    "hierarchy-levels": (HierarchyLevel, {"code", "name", "depth", "has_flow", "allows_uses"}),
}


@router.get("/catalogs/{catalog}", tags=["Catálogos"])
def catalog_list(catalog: str, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    model, _fields = _catalog(catalog)
    return [row_to_dict(x) for x in db.scalars(select(model))]


@router.post("/catalogs/{catalog}", tags=["Catálogos"], status_code=201)
def catalog_create(catalog: str, body: dict, request: Request, db: Session = Depends(get_db),
                   user: AppUser = Depends(require_roles(*EDITORS))):
    model, fields = _catalog(catalog)
    data = {k: v for k, v in body.items() if k in fields}
    obj = model(**data)
    db.add(obj)
    _commit(db)
    pk = getattr(obj, "id", None) or getattr(obj, "code", None)
    audit(db, user, "create", model.__tablename__, pk, after=row_to_dict(obj), request=request)
    db.commit()
    cache.invalidate()
    return row_to_dict(obj)


@router.put("/catalogs/{catalog}/{item_id}", tags=["Catálogos"])
def catalog_update(catalog: str, item_id: str, body: dict, request: Request, db: Session = Depends(get_db),
                   user: AppUser = Depends(require_roles(*EDITORS))):
    model, fields = _catalog(catalog)
    obj = db.get(model, int(item_id) if item_id.isdigit() and model is not HierarchyLevel else item_id)
    if obj is None:
        raise HTTPException(404, "Registro não encontrado.")
    before = row_to_dict(obj)
    for k, v in body.items():
        if k in fields:
            setattr(obj, k, v)
    _commit(db)
    audit(db, user, "update", model.__tablename__, item_id, before, row_to_dict(obj), request)
    db.commit()
    cache.invalidate()
    return row_to_dict(obj)


def _catalog(name: str):
    if name not in CATALOGS:
        raise HTTPException(404, f"Catálogo desconhecido: {name}")
    return CATALOGS[name]


def _commit(db: Session):
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, f"Conflito de integridade: {exc.orig}") from None


# ---------------------------------------------------------------------- auditoria
@router.get("/audit-log", tags=["Auditoria"])
def audit_log(limit: int = 200, entity: str | None = None, db: Session = Depends(get_db),
              _: AppUser = Depends(require_roles("admin", "energy_manager"))):
    q = select(AuditLog).order_by(AuditLog.ts.desc()).limit(min(limit, 1000))
    if entity:
        q = q.where(AuditLog.entity == entity)
    return [row_to_dict(x) for x in db.scalars(q)]
