"""
Policy / audit log API.

GET  /api/audit          — query audit log (actor, action, time range)
POST /api/audit          — write an audit entry (used internally by middleware)

The audit log is append-only — no DELETE or PATCH endpoints.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime

from ..db import get_db
from ..models import AuditLog

router = APIRouter(prefix="/api/audit", tags=["audit"])


class AuditIn(BaseModel):
    actor: str = "system"
    action: str
    resource_type: str | None = None
    resource_id: str | None = None
    reason: str | None = None
    ip: str | None = None
    http_method: str | None = None
    path: str | None = None
    status_code: int | None = None
    result: str = "allow"


def _row_out(r: AuditLog) -> dict:
    return {
        "id": r.id,
        "ts": r.ts.isoformat() if r.ts else None,
        "actor": r.actor,
        "action": r.action,
        "resource_type": r.resource_type,
        "resource_id": r.resource_id,
        "reason": r.reason,
        "ip": r.ip,
        "http_method": r.http_method,
        "path": r.path,
        "status_code": r.status_code,
        "result": r.result,
    }


@router.get("")
def list_audit(
    actor: str | None = None,
    action: str | None = None,
    result: str | None = None,
    limit: int = Query(100, le=1000),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    qs = db.query(AuditLog).order_by(AuditLog.ts.desc())
    if actor:
        qs = qs.filter(AuditLog.actor == actor)
    if action:
        qs = qs.filter(AuditLog.action.ilike(f"%{action}%"))
    if result:
        qs = qs.filter(AuditLog.result == result)
    total = qs.count()
    rows = qs.offset(offset).limit(limit).all()
    return {"total": total, "items": [_row_out(r) for r in rows]}


@router.post("", status_code=201)
def write_audit(body: AuditIn, db: Session = Depends(get_db)):
    row = AuditLog(
        actor=body.actor,
        action=body.action,
        resource_type=body.resource_type,
        resource_id=body.resource_id,
        reason=body.reason,
        ip=body.ip,
        http_method=body.http_method,
        path=body.path,
        status_code=body.status_code,
        result=body.result,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_out(row)
