"""
Knowledge-graph API.

GET  /api/graph/entities        — list/search entities
GET  /api/graph/entities/{id}   — get single entity with neighbours
POST /api/graph/entities        — create entity
POST /api/graph/edges           — create edge
GET  /api/graph/edges           — query edges by src/dst/relation

Traversal endpoint:
GET  /api/graph/traverse/{id}?depth=1&relation=*  — 1-hop or 2-hop subgraph
"""
import json
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Entity, Edge

router = APIRouter(prefix="/api/graph", tags=["graph"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class EntityIn(BaseModel):
    entity_type: str
    name: str
    external_id: str | None = None
    attributes: dict | None = None
    confidence: float = 1.0
    source_ingest_id: int | None = None
    source_event_id: int | None = None


class EntityOut(BaseModel):
    id: int
    entity_type: str
    name: str
    external_id: str | None
    attributes: dict | None
    confidence: float
    created_at: str

    class Config:
        from_attributes = True


class EdgeIn(BaseModel):
    src_id: int
    dst_id: int
    relation: str
    confidence: float = 1.0
    attributes: dict | None = None


class EdgeOut(BaseModel):
    id: int
    src_id: int
    dst_id: int
    relation: str
    confidence: float
    created_at: str

    class Config:
        from_attributes = True


def _entity_to_dict(e: Entity) -> dict:
    return {
        "id": e.id,
        "entity_type": e.entity_type,
        "name": e.name,
        "external_id": e.external_id,
        "attributes": json.loads(e.attributes) if e.attributes else None,
        "confidence": e.confidence,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def _edge_to_dict(ed: Edge) -> dict:
    return {
        "id": ed.id,
        "src_id": ed.src_id,
        "dst_id": ed.dst_id,
        "relation": ed.relation,
        "confidence": ed.confidence,
        "attributes": json.loads(ed.attributes) if ed.attributes else None,
        "created_at": ed.created_at.isoformat() if ed.created_at else None,
    }


# ─── Entity endpoints ─────────────────────────────────────────────────────────

@router.get("/entities")
def list_entities(
    q: str | None = None,
    entity_type: str | None = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    qs = db.query(Entity)
    if entity_type:
        qs = qs.filter(Entity.entity_type == entity_type)
    if q:
        qs = qs.filter(Entity.name.ilike(f"%{q}%"))
    total = qs.count()
    rows = qs.order_by(Entity.created_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [_entity_to_dict(e) for e in rows]}


@router.get("/entities/{entity_id}")
def get_entity(entity_id: int, db: Session = Depends(get_db)):
    e = db.query(Entity).filter(Entity.id == entity_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Entity not found")
    return _entity_to_dict(e)


@router.post("/entities", status_code=201)
def create_entity(body: EntityIn, db: Session = Depends(get_db)):
    e = Entity(
        entity_type=body.entity_type,
        name=body.name,
        external_id=body.external_id,
        attributes=json.dumps(body.attributes) if body.attributes else None,
        confidence=body.confidence,
        source_ingest_id=body.source_ingest_id,
        source_event_id=body.source_event_id,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _entity_to_dict(e)


# ─── Edge endpoints ───────────────────────────────────────────────────────────

@router.get("/edges")
def list_edges(
    src_id: int | None = None,
    dst_id: int | None = None,
    relation: str | None = None,
    limit: int = Query(100, le=1000),
    db: Session = Depends(get_db),
):
    qs = db.query(Edge)
    if src_id:
        qs = qs.filter(Edge.src_id == src_id)
    if dst_id:
        qs = qs.filter(Edge.dst_id == dst_id)
    if relation:
        qs = qs.filter(Edge.relation == relation)
    rows = qs.order_by(Edge.created_at.desc()).limit(limit).all()
    return [_edge_to_dict(ed) for ed in rows]


@router.post("/edges", status_code=201)
def create_edge(body: EdgeIn, db: Session = Depends(get_db)):
    # Verify src/dst exist
    for eid in (body.src_id, body.dst_id):
        if not db.query(Entity).filter(Entity.id == eid).first():
            raise HTTPException(status_code=404, detail=f"Entity {eid} not found")
    ed = Edge(
        src_id=body.src_id,
        dst_id=body.dst_id,
        relation=body.relation,
        confidence=body.confidence,
        attributes=json.dumps(body.attributes) if body.attributes else None,
    )
    db.add(ed)
    db.commit()
    db.refresh(ed)
    return _edge_to_dict(ed)


# ─── Graph traversal ──────────────────────────────────────────────────────────

@router.get("/traverse/{entity_id}")
def traverse(
    entity_id: int,
    depth: int = Query(1, ge=1, le=2),
    relation: str | None = None,
    db: Session = Depends(get_db),
):
    """
    Return a subgraph: the focal entity + all neighbours up to `depth` hops.
    Returns { nodes: [...], edges: [...] }
    """
    root = db.query(Entity).filter(Entity.id == entity_id).first()
    if not root:
        raise HTTPException(status_code=404, detail="Entity not found")

    visited_ids: set[int] = {entity_id}
    frontier: set[int] = {entity_id}
    collected_edges: list[Edge] = []

    for _ in range(depth):
        next_frontier: set[int] = set()
        # Outgoing
        qs_out = db.query(Edge).filter(Edge.src_id.in_(frontier))
        if relation:
            qs_out = qs_out.filter(Edge.relation == relation)
        for ed in qs_out.all():
            collected_edges.append(ed)
            if ed.dst_id not in visited_ids:
                visited_ids.add(ed.dst_id)
                next_frontier.add(ed.dst_id)
        # Incoming
        qs_in = db.query(Edge).filter(Edge.dst_id.in_(frontier))
        if relation:
            qs_in = qs_in.filter(Edge.relation == relation)
        for ed in qs_in.all():
            if ed not in collected_edges:
                collected_edges.append(ed)
            if ed.src_id not in visited_ids:
                visited_ids.add(ed.src_id)
                next_frontier.add(ed.src_id)
        frontier = next_frontier

    nodes = db.query(Entity).filter(Entity.id.in_(visited_ids)).all()
    return {
        "nodes": [_entity_to_dict(n) for n in nodes],
        "edges": [_edge_to_dict(ed) for ed in collected_edges],
        "focal_id": entity_id,
    }
