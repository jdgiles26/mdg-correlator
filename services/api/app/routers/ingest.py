import io
import uuid
import httpx
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from bs4 import BeautifulSoup

from ..db import get_db
from ..models import IngestObject
from ..minio_client import get_minio
from ..settings import settings
from ..events_bus import publish_event
from ..schemas import IngestUrlIn

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

@router.post("/upload")
async def upload(file: UploadFile = File(...), db: Session = Depends(get_db)):
    ct = file.content_type or "application/octet-stream"
    kind = "document"
    if ct.startswith("audio/"):
        kind = "audio"
    elif ct.startswith("video/"):
        kind = "video"

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    object_key = f"uploads/{uuid.uuid4().hex}_{file.filename}"
    mc = get_minio()
    mc.put_object(
        bucket_name=settings.minio_bucket,
        object_name=object_key,
        data=io.BytesIO(data),
        length=len(data),
        content_type=ct,
    )

    rec = IngestObject(
        kind=kind,
        filename=file.filename,
        content_type=ct,
        object_key=object_key,
        source_url=None,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    await publish_event(
        topic="ingest.uploaded",
        severity="INFO",
        source="api",
        payload={"id": rec.id, "kind": kind, "filename": file.filename, "content_type": ct, "object_key": object_key},
    )

    return {"ok": True, "id": rec.id, "object_key": object_key}

@router.post("/url")
async def ingest_url(body: IngestUrlIn, db: Session = Depends(get_db)):
    url = body.url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="URL must be http(s)")

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        r = await client.get(url, headers={"User-Agent": "mission-grid-ingestor/0.1"})
        r.raise_for_status()
        ct = r.headers.get("content-type", "application/octet-stream").split(";")[0].strip().lower()
        raw = r.content

    extracted_text = None
    if ct in ("text/html", "application/xhtml+xml"):
        soup = BeautifulSoup(raw, "html.parser")
        # Drop script/style
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        extracted_text = soup.get_text(" ", strip=True)[:200000]

    object_key = f"url/{uuid.uuid4().hex}"
    mc = get_minio()
    mc.put_object(
        bucket_name=settings.minio_bucket,
        object_name=object_key,
        data=io.BytesIO(raw),
        length=len(raw),
        content_type=ct,
    )

    rec = IngestObject(
        kind="url",
        filename=url,
        content_type=ct,
        object_key=object_key,
        source_url=url,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    await publish_event(
        topic="ingest.url",
        severity="INFO",
        source="api",
        payload={"id": rec.id, "url": url, "content_type": ct, "object_key": object_key, "extracted_text_len": len(extracted_text or "")},
    )

    if extracted_text:
        text_key = f"{object_key}.txt"
        b = extracted_text.encode("utf-8")
        mc.put_object(
            bucket_name=settings.minio_bucket,
            object_name=text_key,
            data=io.BytesIO(b),
            length=len(b),
            content_type="text/plain",
        )
        await publish_event("ingest.url_text", "INFO", "api", {"id": rec.id, "text_key": text_key})

    return {"ok": True, "id": rec.id, "object_key": object_key}
