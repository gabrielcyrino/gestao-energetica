"""Autenticação, autorização por perfil, segregação por nó e trilha de auditoria.

Produção: login delegado ao IdP corporativo via OIDC (ex.: Microsoft Entra ID); a API valida o JWT do
IdP (issuer/audience/JWKS) e mapeia grupos → perfis. Modo DEMO: tokens HS256 emitidos localmente.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import AppUser, AuditLog, HierarchyNode, UserNodeScope

ROLES = {
    "admin": "Administrador",
    "energy_manager": "Gestão de Energia",
    "process_owner": "Dono do Processo",
    "viewer": "Visualizador",
}
EDITORS = ("admin", "energy_manager")

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2_sha256$200000${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        _, iterations, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
    return hmac.compare_digest(digest.hex(), digest_hex)


def create_token(user: AppUser) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(minutes=s.jwt_expire_minutes),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)
) -> AppUser:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Autenticação necessária.", {"WWW-Authenticate": "Bearer"})
    s = get_settings()
    try:
        payload = jwt.decode(creds.credentials, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido ou expirado.") from None
    user = db.get(AppUser, int(payload["sub"]))
    if user is None or not user.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário inativo.")
    return user


def require_roles(*roles: str):
    def checker(user: AppUser = Depends(get_current_user)) -> AppUser:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Perfil '{ROLES.get(user.role, user.role)}' sem permissão.")
        return user

    return checker


def user_scope_paths(db: Session, user: AppUser) -> list[str]:
    ids = list(db.scalars(select(UserNodeScope.node_id).where(UserNodeScope.user_id == user.id)))
    return [n.path for n in db.scalars(select(HierarchyNode).where(HierarchyNode.id.in_(ids)))]


def can_edit_node(db: Session, user: AppUser, node_id: int | None) -> bool:
    if user.role in EDITORS:
        return True
    if user.role != "process_owner" or node_id is None:
        return False
    node = db.get(HierarchyNode, node_id)
    return node is not None and any(node.path.startswith(p) for p in user_scope_paths(db, user))


def ensure_can_edit_node(db: Session, user: AppUser, node_id: int | None) -> None:
    if not can_edit_node(db, user, node_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem permissão para alterar dados deste processo.")


def require_ingestion_key(x_api_key: str | None = Header(default=None)) -> None:
    if not x_api_key or not hmac.compare_digest(x_api_key, get_settings().ingestion_api_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chave de integração inválida.")


def audit(
    db: Session,
    user: AppUser | None,
    action: str,
    entity: str,
    entity_id: str | int | None,
    before: dict | None = None,
    after: dict | None = None,
    request: Request | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            username=user.username if user else None,
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id is not None else None,
            before=_jsonable(before),
            after=_jsonable(after),
            ip=request.client.host if request and request.client else None,
            request_id=request.headers.get("x-request-id") if request else None,
        )
    )


def _jsonable(d: dict | None) -> dict | None:
    if d is None:
        return None
    out = {}
    for k, v in d.items():
        if isinstance(v, (datetime,)):
            out[k] = v.isoformat()
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, (str, int, float, bool, type(None), list, dict)):
            out[k] = v
        else:
            out[k] = str(v)
    return out
