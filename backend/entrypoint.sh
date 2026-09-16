#!/bin/sh
set -e

# Aguarda o banco e cria o schema; carrega a base DEMO apenas se estiver vazia.
python - <<'PY'
import os, time
from sqlalchemy import inspect, select
from app.db import SessionLocal, engine, init_db

for attempt in range(30):
    try:
        with engine.connect():
            break
    except Exception as exc:  # noqa: BLE001
        print(f"aguardando banco ({attempt + 1}/30): {exc}")
        time.sleep(2)
else:
    raise SystemExit("banco indisponível")

init_db()

if os.getenv("EE_SEED_ON_START") == "1":
    from app.models import HierarchyNode
    with SessionLocal() as db:
        if not db.scalar(select(HierarchyNode.id).limit(1)):
            from app.seed.run import seed
            print("carregando base DEMO…")
            seed(db)
        else:
            print("base já populada; seed ignorado.")
PY

exec uvicorn app.main:app --host 0.0.0.0 --port 6472 --proxy-headers
