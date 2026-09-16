"""Oportunidades de melhoria e ingestão de dados (CSV e API de integração)."""
from __future__ import annotations

import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import PeriodQ, get_or_404, resolve_period, row_to_dict
from app.api.lookup import Lookup
from app.api.schemas import MeasurementBatchIn, OpportunityIn
from app.db import get_db
from app.engine.repository import cache
from app.models import AppUser, IngestionBatch, Measurement, Opportunity, Variable
from app.security import audit, ensure_can_edit_node, get_current_user, require_ingestion_key, require_roles

router = APIRouter()

OPEN_STATUS = ("identificada", "em_analise", "aprovada", "em_implementacao")


# ---------------------------------------------------------------------- oportunidades
@router.get("/opportunities", tags=["Oportunidades"])
def list_opportunities(node_id: int | None = None, status: str | None = None, priority: str | None = None,
                       indicator_id: int | None = None, db: Session = Depends(get_db),
                       _: AppUser = Depends(get_current_user)):
    lk = Lookup(db)
    q = select(Opportunity).order_by(Opportunity.created_at.desc())
    items = list(db.scalars(q))
    if node_id:
        node = lk.nodes.get(node_id)
        if node:
            ids = {n.id for n in lk.nodes.values() if n.path.startswith(node.path)}
            items = [o for o in items if o.node_id in ids]
    if status:
        items = [o for o in items if o.status == status]
    if priority:
        items = [o for o in items if o.priority == priority]
    if indicator_id:
        items = [o for o in items if o.indicator_id == indicator_id]
    return {
        "items": [_opportunity_out(lk, o) for o in items],
        "summary": {
            "open": sum(1 for o in items if o.status in OPEN_STATUS),
            "implemented": sum(1 for o in items if o.status in ("implementada", "verificada")),
            "savings_mwh_year": sum(o.estimated_savings_mwh_year or 0 for o in items if o.status in OPEN_STATUS),
            "savings_brl_year": sum(o.estimated_savings_brl_year or 0 for o in items if o.status in OPEN_STATUS),
            "investment_brl": sum(o.estimated_investment_brl or 0 for o in items if o.status in OPEN_STATUS),
        },
    }


@router.get("/opportunities/{opportunity_id}", tags=["Oportunidades"])
def get_opportunity(opportunity_id: int, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    o = get_or_404(db, Opportunity, opportunity_id, "Oportunidade")
    return _opportunity_out(Lookup(db), o)


@router.post("/opportunities", tags=["Oportunidades"], status_code=201)
def create_opportunity(body: OpportunityIn, request: Request, db: Session = Depends(get_db),
                       user: AppUser = Depends(get_current_user)):
    ensure_can_edit_node(db, user, body.node_id)
    year = datetime.now().year
    seq = db.scalar(select(func.count()).select_from(Opportunity)) or 0
    obj = Opportunity(code=f"OP-{year}-{seq + 1:03d}", created_by_id=user.id, **body.model_dump())
    db.add(obj)
    db.flush()
    audit(db, user, "create", "opportunity", obj.id, after=row_to_dict(obj), request=request)
    db.commit()
    return _opportunity_out(Lookup(db), obj)


@router.put("/opportunities/{opportunity_id}", tags=["Oportunidades"])
def update_opportunity(opportunity_id: int, body: OpportunityIn, request: Request, db: Session = Depends(get_db),
                       user: AppUser = Depends(get_current_user)):
    obj = get_or_404(db, Opportunity, opportunity_id, "Oportunidade")
    ensure_can_edit_node(db, user, obj.node_id)
    before = row_to_dict(obj)
    for k, v in body.model_dump().items():
        setattr(obj, k, v)
    db.flush()
    audit(db, user, "update", "opportunity", obj.id, before, row_to_dict(obj), request)
    db.commit()
    return _opportunity_out(Lookup(db), obj)


@router.delete("/opportunities/{opportunity_id}", tags=["Oportunidades"], status_code=204)
def delete_opportunity(opportunity_id: int, request: Request, db: Session = Depends(get_db),
                       user: AppUser = Depends(require_roles("admin", "energy_manager"))):
    obj = get_or_404(db, Opportunity, opportunity_id, "Oportunidade")
    audit(db, user, "delete", "opportunity", obj.id, row_to_dict(obj), None, request)
    db.delete(obj)
    db.commit()


def _opportunity_out(lk: Lookup, o: Opportunity) -> dict:
    return {
        **row_to_dict(o),
        "node": lk.node_brief(o.node_id),
        "area": lk.area_of(o.node_id),
        "use": {"id": o.use_id, "name": lk.uses[o.use_id].name} if o.use_id in lk.uses else None,
        "equipment": {"id": o.equipment_id, "tag": lk.equipment[o.equipment_id].tag,
                      "name": lk.equipment[o.equipment_id].name} if o.equipment_id in lk.equipment else None,
        "indicator": _indicator_brief(lk, o.indicator_id),
        "responsible": lk.person(o.responsible_id),
    }


def _indicator_brief(lk: Lookup, indicator_id: int | None) -> dict | None:
    if not indicator_id:
        return None
    from app.models import Indicator

    ind = lk.db.get(Indicator, indicator_id)
    return {"id": ind.id, "code": ind.code, "name": ind.name, "unit": lk.unit(ind.unit_id)} if ind else None


# ---------------------------------------------------------------------- ingestão
@router.post("/ingestion/csv", tags=["Ingestão"])
async def ingest_csv(file: UploadFile = File(...), request: Request = None, db: Session = Depends(get_db),
                     user: AppUser = Depends(require_roles("admin", "energy_manager"))):
    """CSV com colunas: variable_code;ts;value[;quality]  (separador , ou ;).

    Linhas inválidas são rejeitadas com motivo — valores ausentes NÃO viram zero."""
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    dialect = csv.Sniffer().sniff(raw[:2000], delimiters=",;\t") if raw.strip() else csv.excel
    reader = csv.DictReader(io.StringIO(raw), dialect=dialect)
    batch = IngestionBatch(source="csv", filename=file.filename, user_id=user.id)
    db.add(batch)
    db.flush()
    report = _ingest_rows(db, reader, batch)
    audit(db, user, "ingest", "measurement", batch.id, after=report, request=request)
    db.commit()
    cache.invalidate()
    return report


@router.post("/ingestion/measurements", tags=["Ingestão"], dependencies=[Depends(require_ingestion_key)])
def ingest_measurements(body: MeasurementBatchIn, db: Session = Depends(get_db)):
    """Endpoint máquina-a-máquina (gateway OPC UA/MQTT → API) autenticado por chave de integração."""
    batch = IngestionBatch(source=body.source)
    db.add(batch)
    db.flush()
    rows = ({"variable_code": m.variable_code, "ts": m.ts, "value": m.value, "quality": m.quality}
            for m in body.measurements)
    report = _ingest_rows(db, rows, batch)
    db.commit()
    cache.invalidate()
    return report


def _ingest_rows(db: Session, rows, batch: IngestionBatch) -> dict:
    var_by_code = {v.code: v for v in db.scalars(select(Variable))}
    var_by_tag = {v.source_tag: v for v in db.scalars(select(Variable)) if v.source_tag}
    ok = rejected = 0
    errors: list[dict] = []
    for n, row in enumerate(rows, start=2):
        code = (row.get("variable_code") or row.get("tag") or row.get("codigo") or "").strip()
        var = var_by_code.get(code) or var_by_tag.get(code)
        raw_ts = (row.get("ts") or row.get("timestamp") or row.get("data") or "").strip()
        raw_value = row.get("value") if row.get("value") is not None else row.get("valor")
        quality = (row.get("quality") or row.get("qualidade") or "good").strip() or "good"
        if var is None:
            rejected += 1
            _err(errors, n, code, "variável não cadastrada")
            continue
        try:
            ts = datetime.fromisoformat(raw_ts)
        except (TypeError, ValueError):
            rejected += 1
            _err(errors, n, code, f"timestamp inválido: {raw_ts!r}")
            continue
        value = None
        if raw_value not in (None, "", "NaN", "nan", "null"):
            try:
                value = float(str(raw_value).replace(",", "."))
            except ValueError:
                rejected += 1
                _err(errors, n, code, f"valor não numérico: {raw_value!r}")
                continue
        elif quality not in ("bad", "suspect"):
            rejected += 1
            _err(errors, n, code, "valor ausente sem marcação de qualidade (não é convertido em zero)")
            continue
        existing = db.get(Measurement, {"variable_id": var.id, "ts": ts})
        if existing:
            existing.value, existing.quality, existing.batch_id = value, quality, batch.id
        else:
            db.add(Measurement(variable_id=var.id, ts=ts, value=value, quality=quality, source=batch.source,
                               batch_id=batch.id))
        ok += 1
    batch.rows_total = ok + rejected
    batch.rows_ok = ok
    batch.rows_rejected = rejected
    batch.errors = errors[:200]
    return {"batch_id": batch.id, "rows_total": batch.rows_total, "rows_ok": ok, "rows_rejected": rejected,
            "errors": batch.errors}


def _err(errors: list[dict], line: int, code: str, message: str) -> None:
    if len(errors) < 200:
        errors.append({"line": line, "variable_code": code, "error": message})


@router.get("/ingestion/batches", tags=["Ingestão"])
def list_batches(limit: int = 50, db: Session = Depends(get_db),
                 _: AppUser = Depends(require_roles("admin", "energy_manager"))):
    return [row_to_dict(b) for b in db.scalars(select(IngestionBatch).order_by(IngestionBatch.id.desc()).limit(limit))]


@router.get("/ingestion/template.csv", tags=["Ingestão"])
def csv_template(period: str | None = PeriodQ, db: Session = Depends(get_db),
                 _: AppUser = Depends(get_current_user)):
    a = resolve_period(db, period)
    sample = db.scalars(select(Variable).limit(3))
    lines = ["variable_code;ts;value;quality"]
    for v in sample:
        lines.append(f"{v.code};{a.eff_end.isoformat()}T00:00:00;;good")
    return {"filename": "modelo-ingestao.csv", "content": "\n".join(lines),
            "note": "Deixe 'value' vazio apenas com quality=bad/suspect — ausência de dado nunca é zero."}
