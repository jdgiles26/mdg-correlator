"""
Semantic search API — powered by Qdrant vector similarity.

POST /api/search/semantic   — text query → similar chunks
GET  /api/search/chunks     — list recently ingested chunks (no embedding required)

When ENABLE_EMBEDDINGS=false the endpoint returns a graceful "not enabled" message
so the UI can degrade cleanly.
"""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Chunk, IngestObject
from ..settings import settings

router = APIRouter(prefix="/api/search", tags=["search"])

# ─── Lazy Qdrant client ───────────────────────────────────────────────────────

_qdrant_client = None

def _get_qdrant():
    global _qdrant_client
    if _qdrant_client is None:
        from qdrant_client import QdrantClient  # type: ignore
        _qdrant_client = QdrantClient(host="qdrant", port=6333)
    return _qdrant_client


# ─── Lazy embedding model ─────────────────────────────────────────────────────

_embed_model = None

def _get_embed():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer  # type: ignore
        _embed_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embed_model


# ─── Schemas ──────────────────────────────────────────────────────────────────

class SemanticQuery(BaseModel):
    query: str
    top_k: int = 10
    score_threshold: float = 0.30
    source_type: str | None = None   # osint|document|url|event|None=all


class SearchHit(BaseModel):
    chunk_id: int
    qdrant_id: str | None
    score: float
    text: str
    source_label: str | None
    source_type: str
    ingest_id: int


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/semantic")
def semantic_search(body: SemanticQuery, db: Session = Depends(get_db)):
    if not settings.enable_embeddings:
        return {"enabled": False, "hits": [], "message": "Embeddings are disabled. Set ENABLE_EMBEDDINGS=true."}

    try:
        model = _get_embed()
        qdrant = _get_qdrant()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Embedding/Qdrant unavailable: {exc}")

    # Embed the query
    vec = model.encode(body.query).tolist()

    # Query Qdrant
    filter_payload = {}
    if body.source_type:
        filter_payload = {"must": [{"key": "source_type", "match": {"value": body.source_type}}]}

    results = qdrant.search(
        collection_name="mission_chunks",
        query_vector=vec,
        limit=body.top_k,
        score_threshold=body.score_threshold,
        query_filter=filter_payload if filter_payload else None,
        with_payload=True,
    )

    hits = []
    for r in results:
        payload = r.payload or {}
        chunk_id = payload.get("chunk_id")
        chunk = db.query(Chunk).filter(Chunk.id == chunk_id).first() if chunk_id else None
        hits.append({
            "qdrant_id": str(r.id),
            "score": round(r.score, 4),
            "text": payload.get("text", ""),
            "source_label": payload.get("source_label"),
            "source_type": payload.get("source_type", "unknown"),
            "ingest_id": payload.get("ingest_id"),
            "chunk_id": chunk_id,
        })

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
                "qdrant_id": c.qdrant_id,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in rows
        ],
    }
