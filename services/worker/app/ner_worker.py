"""
NER (Named Entity Recognition) + Graph-population worker.

Subscribes to:
  osint.item      — extract entities from OSINT feed items
  ingest.url_text — extract entities from scraped URL text
  video.detections — create Observation entities from detection events

Uses spaCy's en_core_web_sm model (CPU-only, ~12 MB).

For each entity found:
  - Upsert into entities table (deduplication by name+type)
  - Create edges: Document MENTIONS Entity, Observation NEAR Entity, etc.
"""
import asyncio
import json
from typing import Any

from .db import SessionLocal
from .nats_bus import publish
from .settings import settings
from .runtime_settings import get_runtime_ai_settings

# ─── Lazy model ───────────────────────────────────────────────────────────────

_nlp = None

def _get_nlp():
    global _nlp
    if _nlp is None:
        import spacy  # type: ignore
        try:
            _nlp = spacy.load("en_core_web_sm")
        except OSError:
            # Auto-download on first run
            from spacy.cli import download  # type: ignore
            download("en_core_web_sm")
            _nlp = spacy.load("en_core_web_sm")
    return _nlp


# ─── spaCy type → ontology type mapping ──────────────────────────────────────

SPACY_TO_ONTOLOGY = {
    "PERSON":   "Actor",
    "ORG":      "Actor",
    "GPE":      "Location",
    "LOC":      "Location",
    "FAC":      "Location",
    "PRODUCT":  "Asset",
    "WORK_OF_ART": "Document",
    "NORP":     "Actor",
    "EVENT":    "Event",
    "LAW":      "Document",
    "LANGUAGE": None,         # skip
    "DATE":     None,
    "TIME":     None,
    "MONEY":    None,
    "QUANTITY": None,
    "CARDINAL": None,
    "ORDINAL":  None,
    "PERCENT":  None,
}


# ─── DB helpers ───────────────────────────────────────────────────────────────

def _upsert_entity(db, entity_type: str, name: str, confidence: float = 0.8, **kwargs) -> int:
    """Get-or-create entity; return its id."""
    from .models import Entity
    name = name.strip()[:512]
    if not name:
        return -1
    existing = (
        db.query(Entity)
        .filter(Entity.entity_type == entity_type, Entity.name == name)
        .first()
    )
    if existing:
        return existing.id
    e = Entity(entity_type=entity_type, name=name, confidence=confidence, **kwargs)
    db.add(e)
    db.flush()
    return e.id


def _upsert_edge(db, src_id: int, dst_id: int, relation: str, confidence: float = 0.8):
    from .models import Edge
    if src_id < 0 or dst_id < 0:
        return
    existing = (
        db.query(Edge)
        .filter(
            Edge.src_id == src_id,
            Edge.dst_id == dst_id,
            Edge.relation == relation,
        )
        .first()
    )
    if not existing:
        db.add(Edge(src_id=src_id, dst_id=dst_id, relation=relation, confidence=confidence))


# ─── Text extraction helper ───────────────────────────────────────────────────

def _extract_and_store(text: str, source_entity_id: int, relation: str, db):
    nlp = _get_nlp()
    doc = nlp(text[:100_000])  # cap at 100k chars

    entity_ids = []
    for ent in doc.ents:
        otype = SPACY_TO_ONTOLOGY.get(ent.label_)
        if not otype:
            continue
        eid = _upsert_entity(db, otype, ent.text, confidence=0.75)
        if eid >= 0:
            _upsert_edge(db, source_entity_id, eid, relation, confidence=0.75)
            entity_ids.append(eid)

    db.commit()
    return entity_ids


# ─── Event handlers ───────────────────────────────────────────────────────────

def _handle_osint(payload: dict) -> int:
    item = payload.get("item", {})
    text = " ".join(filter(None, [
        item.get("title", ""),
        item.get("summary", ""),
    ])).strip()
    if not text:
        return 0

    source_name = f"[{payload.get('source', 'osint')}] {item.get('title', '')[:80]}"
    db = SessionLocal()
    try:
        # Create/get the document entity representing this OSINT item
        doc_id = _upsert_entity(db, "Document", source_name, confidence=1.0)
        db.flush()
        count = len(_extract_and_store(text, doc_id, "MENTIONS", db))
        return count
    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()


def _handle_detection(payload: dict) -> int:
    """Create Observation entity from detection event."""
    feed = payload.get("feed", "unknown")
    detections = payload.get("detections", [])
    if not detections:
        return 0

    db = SessionLocal()
    try:
        feed_id = _upsert_entity(db, "Feed", feed, confidence=1.0)
        db.flush()
        for det in detections[:50]:
            label = det.get("label") or det.get("class") or det.get("class_name") or "detection"
            conf = float(det.get("conf", det.get("score", 0.5)))
            obs_name = f"{label} on {feed}"
            obs_id = _upsert_entity(db, "Observation", obs_name, confidence=conf)
            db.flush()
            _upsert_edge(db, feed_id, obs_id, "PRODUCED", confidence=conf)
        db.commit()
        return len(detections)
    except Exception:
        db.rollback()
        return 0
    finally:
        db.close()


# ─── Main loop ────────────────────────────────────────────────────────────────

async def ner_loop(stop_event: asyncio.Event):
    await publish("ner.start", "INFO", "ner_worker", {})

    import nats  # type: ignore
    nc = await nats.connect(settings.nats_url)
    queue: asyncio.Queue = asyncio.Queue()

    async def _cb(msg):
        try:
            data = json.loads(msg.data.decode())
            await queue.put((msg.subject, data))
        except Exception:
            pass

    await nc.subscribe("osint.item", cb=_cb)
    await nc.subscribe("video.detections", cb=_cb)

    try:
        while not stop_event.is_set():
            try:
                topic, data = await asyncio.wait_for(queue.get(), timeout=1.0)
                ai = get_runtime_ai_settings()
                if not ai.get("ner_enabled", False):
                    continue
                payload = data.get("payload", {})
                loop = asyncio.get_event_loop()
                try:
                    if topic == "osint.item":
                        count = await loop.run_in_executor(None, _handle_osint, payload)
                        if count:
                            await publish("ner.entities_extracted", "INFO", "ner_worker",
                                          {"topic": topic, "entities": count})
                    elif topic == "video.detections":
                        await loop.run_in_executor(None, _handle_detection, payload)
                except Exception as e:
                    await publish("ner.error", "WARN", "ner_worker",
                                  {"topic": topic, "error": str(e)[:300]})
            except asyncio.TimeoutError:
                pass
    finally:
        await nc.close()
