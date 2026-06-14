"""
Embedding worker — subscribes to ingest events and:
  1. Splits text into ~800-token chunks
  2. Embeds them with sentence-transformers/all-MiniLM-L6-v2
  3. Stores embeddings in Postgres via pgvector
  4. Persists chunk metadata to Postgres (chunks table)

Only runs when ENABLE_EMBEDDINGS=true.
"""
import asyncio
import json
from typing import Any

from sqlalchemy import text

from .db import SessionLocal, engine
from .nats_bus import publish
from .runtime_settings import get_runtime_ai_settings
from .settings import settings


_model = None
VECTOR_DIM = 384  # all-MiniLM-L6-v2


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer  # type: ignore

        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def _ensure_vector_schema():
    from .models import Base

    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding vector({VECTOR_DIM})"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chunks_source_type ON chunks (source_type)"))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_chunks_embedding_hnsw "
                "ON chunks USING hnsw (embedding vector_cosine_ops)"
            )
        )
    engine.dispose()


def _chunk_text(text_value: str, max_chars: int = 2400) -> list[str]:
    """Split text into ~800 word / ~2400 char chunks with 200-char overlap."""
    cleaned = text_value.strip()
    if not cleaned:
        return []
    if len(cleaned) <= max_chars:
        return [cleaned]
    chunks = []
    step = max_chars - 200
    for i in range(0, len(cleaned), step):
        chunk = cleaned[i: i + max_chars].strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def _embed_and_store(
    ingest_id: int,
    text_value: str,
    source_type: str,
    source_label: str,
) -> int:
    """Chunk, embed and store in Postgres. Returns number of chunks stored."""
    from .models import Chunk  # local import to avoid circular

    ai = get_runtime_ai_settings()
    if not ai.get("embeddings_enabled", settings.enable_embeddings):
        return 0

    chunks = _chunk_text(text_value)
    if not chunks:
        return 0

    _ensure_vector_schema()
    model = _get_model()
    vectors = model.encode(chunks, normalize_embeddings=True).tolist()
    db = SessionLocal()

    try:
        db.add_all([
            Chunk(
                ingest_id=ingest_id,
                chunk_index=idx,
                text=chunk,
                embedding=vector,
                source_type=source_type,
                source_label=source_label,
            )
            for idx, (chunk, vector) in enumerate(zip(chunks, vectors))
        ])
        db.commit()
        return len(chunks)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def _handle_osint_item(msg: dict[str, Any]):
    """Embed an OSINT feed item."""
    payload = msg.get("payload", {})
    item = payload.get("item", {})
    text_value = " ".join(
        filter(
            None,
            [
                item.get("title", ""),
                item.get("summary", ""),
                item.get("link", ""),
            ],
        )
    ).strip()
    if not text_value:
        return
    source_label = f"[{payload.get('source', 'osint')}] {item.get('title', '')[:80]}"
    _embed_and_store(0, text_value, "osint", source_label)


async def _handle_ingest_url_text(msg: dict[str, Any]):
    payload = msg.get("payload", {})
    ingest_id = payload.get("id", 0)
    text_key = payload.get("text_key", "")
    if not text_key:
        return

    try:
        from minio import Minio  # type: ignore

        mc = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=False,
        )
        obj = mc.get_object(settings.minio_bucket, text_key)
        text_value = obj.read().decode("utf-8", errors="replace")
    except Exception:
        return

    _embed_and_store(ingest_id, text_value, "url", text_key)


async def _handle_ingest_uploaded(msg: dict[str, Any]):
    """Attempt to embed uploaded document text if it can be read as plain text."""
    payload = msg.get("payload", {})
    ct = payload.get("content_type", "")
    if "text" not in ct:
        return
    ingest_id = payload.get("id", 0)
    object_key = payload.get("object_key", "")
    if not object_key:
        return

    try:
        from minio import Minio  # type: ignore

        mc = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=False,
        )
        obj = mc.get_object(settings.minio_bucket, object_key)
        text_value = obj.read().decode("utf-8", errors="replace")
    except Exception:
        return

    _embed_and_store(ingest_id, text_value, "document", object_key)


TOPIC_HANDLERS = {
    "osint.item": _handle_osint_item,
    "ingest.url_text": _handle_ingest_url_text,
    "ingest.uploaded": _handle_ingest_uploaded,
}


async def embed_loop(stop_event: asyncio.Event):
    if not settings.enable_embeddings:
        return

    await publish("embed.start", "INFO", "embed_worker", {"backend": "pgvector", "target": "chunks.embedding"})

    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _ensure_vector_schema)
        await publish("embed.ready", "INFO", "embed_worker", {"status": "schema ready", "backend": "pgvector"})
    except Exception as exc:
        await publish("embed.error", "WARN", "embed_worker", {"error": str(exc)[:300]})
        return

    from nats.aio.client import Client as NATS  # type: ignore

    nc = NATS()
    await nc.connect(settings.nats_url)

    queue: asyncio.Queue = asyncio.Queue()

    async def _cb(msg):
        try:
            data = json.loads(msg.data.decode())
            await queue.put((msg.subject, data))
        except Exception:
            pass

    for topic in TOPIC_HANDLERS:
        await nc.subscribe(topic, cb=_cb)

    try:
        while not stop_event.is_set():
            try:
                topic, data = await asyncio.wait_for(queue.get(), timeout=1.0)
                ai = get_runtime_ai_settings()
                if not ai.get("embeddings_enabled", settings.enable_embeddings):
                    continue
                handler = TOPIC_HANDLERS.get(topic)
                if handler:
                    try:
                        loop = asyncio.get_event_loop()
                        await loop.run_in_executor(
                            None,
                            lambda: asyncio.new_event_loop().run_until_complete(handler(data)),
                        )
                    except Exception as exc:
                        await publish(
                            "embed.error",
                            "WARN",
                            "embed_worker",
                            {"topic": topic, "error": str(exc)[:300]},
                        )
            except asyncio.TimeoutError:
                pass
    finally:
        await nc.close()
