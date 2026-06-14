"""
Semantic search API backed by pgvector in Postgres.

POST /api/search/semantic   — text query → similar chunks
GET  /api/search/chunks     — list recently ingested chunks (no embedding required)

When ENABLE_EMBEDDINGS=false the endpoint returns a graceful "not enabled" message
so the UI can degrade cleanly.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Chunk
from ..runtime_settings import load_ai_settings
from ..settings import settings

router = APIRouter(prefix="/api/search", tags=["search"])


_embed_model = None


def _get_embed():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer  # type: ignore

        _embed_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embed_model


class SemanticQuery(BaseModel):
    query: str
    top_k: int = 10
    score_threshold: float = 0.30
    source_type: str | None = None   # osint|document|url|event|None=all


class SearchHit(BaseModel):
    chunk_id: int
    score: float
    text: str
    source_label: str | None
    source_type: str
    ingest_id: int


@router.post("/semantic")
def semantic_search(body: SemanticQuery, db: Session = Depends(get_db)):
    ai = load_ai_settings(db)
    if not settings.enable_embeddings or not ai.get("embeddings_enabled", settings.enable_embeddings):
        return {"enabled": False, "hits": [], "message": "Embeddings are disabled in AI Controls."}

    try:
        model = _get_embed()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Embedding model unavailable: {exc}")

    query_vector = model.encode(body.query, normalize_embeddings=True).tolist()
    top_k = max(1, min(body.top_k, 50))
    similarity_floor = max(-1.0, min(body.score_threshold, 1.0))
    distance = Chunk.embedding.cosine_distance(query_vector)

    stmt = (
        select(Chunk, distance.label("distance"))
        .where(Chunk.embedding.is_not(None))
        .where(distance <= 1 - similarity_floor)
    )
    if body.source_type:
        stmt = stmt.where(Chunk.source_type == body.source_type)
    stmt = stmt.order_by(distance).limit(top_k)

    rows = db.execute(stmt).all()
    hits = []
    for chunk, distance_value in rows:
        hits.append(
            {
                "score": round(max(-1.0, 1 - float(distance_value)), 4),
                "text": chunk.text,
                "source_label": chunk.source_label,
                "source_type": chunk.source_type,
                "ingest_id": chunk.ingest_id,
                "chunk_id": chunk.id,
            }
        )

    return {"enabled": True, "hits": hits, "query": body.query}


@router.get("/chunks")
def list_chunks(
    source_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    qs = db.query(Chunk)
    if source_type:
        qs = qs.filter(Chunk.source_type == source_type)
    total = qs.count()
    rows = qs.order_by(Chunk.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id": c.id,
                "ingest_id": c.ingest_id,
                "chunk_index": c.chunk_index,
                "text_preview": c.text[:200],
                "source_type": c.source_type,
                "source_label": c.source_label,
                "has_embedding": c.embedding is not None,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in rows
        ],
    }
