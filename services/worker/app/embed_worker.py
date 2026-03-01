"""
Embedding worker — subscribes to ingest events and:
  1. Splits text into ~800-token chunks
  2. Embeds them with sentence-transformers/all-MiniLM-L6-v2
  3. Upserts into Qdrant collection "mission_chunks"
  4. Persists chunk metadata to Postgres (chunks table)

Only runs when ENABLE_EMBEDDINGS=true.
"""
import asyncio
import json
import uuid
import textwrap
from typing import Any

from .db import SessionLocal
from .nats_bus import subscribe_topic, publish
from .settings import settings

# ─── Lazy singletons ─────────────────────────────────────────────────────────

_model = None
_qdrant = None
COLLECTION = "mission_chunks"
VECTOR_DIM = 384  # all-MiniLM-L6-v2


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer  # type: ignore
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def _get_qdrant():
    global _qdrant
    if _qdrant is None:
        from qdrant_client import QdrantClient  # type: ignore
        from qdrant_client.models import Distance, VectorParams, CollectionsResponse  # type: ignore
        client = QdrantClient(host="qdrant", port=6333)
        # Ensure collection exists
        try:
            client.get_collection(COLLECTION)
        except Exception:
            client.create_collection(
                collection_name=COLLECTION,
                vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
            )
        _qdrant = client
    return _qdrant


# ─── Chunking ─────────────────────────────────────────────────────────────────

def _chunk_text(text: str, max_chars: int = 2400) -> list[str]:
    """Split text into ~800 word / ~2400 char chunks with 200-char overlap."""
    if len(text) <= max_chars:
        return [text.strip()]
    chunks = []
    step = max_chars - 200
    for i in range(0, len(text), step):
        chunk = text[i: i + max_chars].strip()
        if chunk:
            chunks.append(chunk)
    return chunks


# ─── Core embed + upsert ──────────────────────────────────────────────────────

def _embed_and_store(
    ingest_id: int,
    text: str,
    source_type: str,
    source_label: str,
) -> int:
    """Chunk, embed and upsert.  Returns number of chunks stored."""
    from qdrant_client.models import PointStruct  # type: ignore
    from .models import Chunk  # local import to avoid circular

    model = _get_model()
    qdrant = _get_qdrant()
    db = SessionLocal()
    chunks = _chunk_text(text)
    stored = 0

    try:
        points = []
        db_chunks = []
        for idx, chunk in enumerate(chunks):
            vec = model.encode(chunk).tolist()
            qid = str(uuid.uuid4())
            points.append(PointStruct(
                id=qid,
                vector=vec,
                payload={
                    "ingest_id": ingest_id,
                    "chunk_index": idx,
                    "text": chunk[:500],          # keep payload small
                    "source_type": source_type,
                    "source_label": source_label,
                },
            ))
            db_chunks.append(Chunk(
                ingest_id=ingest_id,
                chunk_index=idx,
                text=chunk,
                qdrant_id=qid,
                source_type=source_type,
                source_label=source_label,
            ))

        if points:
            qdrant.upsert(collection_name=COLLECTION, points=points)
            for c in db_chunks:
                db.add(c)
            db.commit()
            stored = len(points)
    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()

    return stored


# ─── Event handlers ───────────────────────────────────────────────────────────

async def _handle_osint_item(msg: dict[str, Any]):
    """Embed an OSINT feed item."""
    payload = msg.get("payload", {})
    item = payload.get("item", {})
    text = " ".join(filter(None, [
        item.get("title", ""),
        item.get("summary", ""),
        item.get("link", ""),
    ])).strip()
    if not text:
        return
    source_label = f"[{payload.get('source', 'osint')}] {item.get('title', '')[:80]}"
    # We don't have an ingest_id for raw OSINT items; store 0 as sentinel
    _embed_and_store(0, text, "osint", source_label)


async def _handle_ingest_url_text(msg: dict[str, Any]):
    payload = msg.get("payload", {})
    ingest_id = payload.get("id", 0)
    text_key = payload.get("text_key", "")
    if not text_key:
        return

    # Fetch text from MinIO
    try:
        from minio import Minio  # type: ignore
        mc = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=False,
        )
        obj = mc.get_object(settings.minio_bucket, text_key)
        text = obj.read().decode("utf-8", errors="replace")
    except Exception:
        return

    _embed_and_store(ingest_id, text, "url", text_key)


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
        text = obj.read().decode("utf-8", errors="replace")
    except Exception:
        return

    _embed_and_store(ingest_id, text, "document", object_key)


# ─── Main loop ────────────────────────────────────────────────────────────────

TOPIC_HANDLERS = {
    "osint.item": _handle_osint_item,
    "ingest.url_text": _handle_ingest_url_text,
    "ingest.uploaded": _handle_ingest_uploaded,
}


async def embed_loop(stop_event: asyncio.Event):
    if not settings.enable_embeddings:
        return

    await publish("embed.start", "INFO", "embed_worker", {"collection": COLLECTION})

    try:
        # Warm up model and Qdrant in a thread to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _get_model)
        await loop.run_in_executor(None, _get_qdrant)
        await publish("embed.ready", "INFO", "embed_worker", {"status": "model loaded"})
    except Exception as e:
        await publish("embed.error", "WARN", "embed_worker", {"error": str(e)[:300]})
        return

    # Subscribe to ingest events via NATS (simple polling approach)
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
                handler = TOPIC_HANDLERS.get(topic)
                if handler:
                    try:
                        loop = asyncio.get_event_loop()
                        # Run CPU-bound embedding in thread pool
                        await loop.run_in_executor(None, lambda: asyncio.new_event_loop().run_until_complete(handler(data)))
                    except Exception as e:
                        await publish("embed.error", "WARN", "embed_worker",
                                      {"topic": topic, "error": str(e)[:300]})
            except asyncio.TimeoutError:
                pass
    finally:
        await nc.close()
