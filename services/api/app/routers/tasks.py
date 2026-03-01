"""
Tasking workflow API.

GET    /api/tasks              — list tasks (filterable by status/priority)
POST   /api/tasks              — create task (optionally from event/entity)
GET    /api/tasks/{id}         — get task + audit trail
PATCH  /api/tasks/{id}         — update status / assignee / outcome
DELETE /api/tasks/{id}         — cancel (sets status=cancelled)
GET    /api/tasks/{id}/events  — audit trail only
"""
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Task, TaskEvent, Event as BusEvent, AuditLog
from ..events_bus import publish_event

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

# ─── Schemas ──────────────────────────────────────────────────────────────────

class TaskIn(BaseModel):
    title: str
    description: str | None = None
    priority: str = "normal"
    source_event_id: int | None = None
    source_entity_id: int | None = None
    assignee: str | None = None
    due_ts: datetime | None = None
    created_by: str = "operator"


class TaskPatch(BaseModel):
    status: str | None = None
    priority: str | None = None
    assignee: str | None = None
    outcome: str | None = None
    description: str | None = None
    actor: str = "operator"
    note: str | None = None


def _task_out(t: Task) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "status": t.status,
        "priority": t.priority,
        "source_event_id": t.source_event_id,
        "source_entity_id": t.source_entity_id,
        "assignee": t.assignee,
        "due_ts": t.due_ts.isoformat() if t.due_ts else None,
        "outcome": t.outcome,
        "created_by": t.created_by,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }

def _te_out(te: TaskEvent) -> dict:
    return {
        "id": te.id,
        "task_id": te.task_id,
        "actor": te.actor,
        "action": te.action,
        "detail": te.detail,
        "ts": te.ts.isoformat() if te.ts else None,
    }


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
def list_tasks(
    status: str | None = None,
    priority: str | None = None,
    assignee: str | None = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    qs = db.query(Task)
    if status:
        qs = qs.filter(Task.status == status)
    if priority:
        qs = qs.filter(Task.priority == priority)
    if assignee:
        qs = qs.filter(Task.assignee == assignee)
    total = qs.count()
    rows = qs.order_by(Task.created_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_task_out(t) for t in rows]}


@router.post("", status_code=201)
async def create_task(body: TaskIn, db: Session = Depends(get_db)):
    t = Task(
        title=body.title,
        description=body.description,
        status="open",
        priority=body.priority,
        source_event_id=body.source_event_id,
        source_entity_id=body.source_entity_id,
        assignee=body.assignee,
        due_ts=body.due_ts,
        created_by=body.created_by,
    )
    db.add(t)
    db.flush()
    te = TaskEvent(task_id=t.id, actor=body.created_by, action="created",
                   detail=f"Task created: {body.title}")
    db.add(te)
    db.commit()
    db.refresh(t)
    await publish_event("task.created", "INFO", "api",
                        {"task_id": t.id, "title": t.title, "priority": t.priority})
    return _task_out(t)


@router.get("/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db)):
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    events = db.query(TaskEvent).filter(TaskEvent.task_id == task_id).order_by(TaskEvent.ts.asc()).all()
    return {**_task_out(t), "audit_trail": [_te_out(e) for e in events]}


@router.patch("/{task_id}")
async def patch_task(task_id: int, body: TaskPatch, db: Session = Depends(get_db)):
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")

    changes = []
    if body.status and body.status != t.status:
        old = t.status
        t.status = body.status
        changes.append(f"status: {old} → {body.status}")
    if body.priority and body.priority != t.priority:
        t.priority = body.priority
        changes.append(f"priority → {body.priority}")
    if body.assignee is not None:
        t.assignee = body.assignee
        changes.append(f"assignee → {body.assignee}")
    if body.outcome is not None:
        t.outcome = body.outcome
        changes.append("outcome set")
    if body.description is not None:
        t.description = body.description

    action = "status_change" if body.status else "note"
    detail = "; ".join(changes) if changes else (body.note or "updated")
    if body.note:
        detail = (detail + " | " + body.note) if changes else body.note

    te = TaskEvent(task_id=t.id, actor=body.actor, action=action, detail=detail)
    db.add(te)
    db.commit()
    db.refresh(t)

    await publish_event("task.updated", "INFO", "api",
                        {"task_id": t.id, "status": t.status, "changes": changes})
    return _task_out(t)


@router.delete("/{task_id}")
async def cancel_task(task_id: int, actor: str = "operator", db: Session = Depends(get_db)):
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    t.status = "cancelled"
    te = TaskEvent(task_id=t.id, actor=actor, action="cancelled", detail="Task cancelled")
    db.add(te)
    db.commit()
    await publish_event("task.cancelled", "INFO", "api", {"task_id": t.id})
    return {"ok": True, "task_id": task_id}


@router.get("/{task_id}/events")
def task_events(task_id: int, db: Session = Depends(get_db)):
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    events = db.query(TaskEvent).filter(TaskEvent.task_id == task_id).order_by(TaskEvent.ts.asc()).all()
    return [_te_out(e) for e in events]
