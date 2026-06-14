from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import Feed
from ..schemas import FeedCreate, FeedOut
from ..settings import settings
from ..events_bus import publish_event

router = APIRouter(prefix="/api/feeds", tags=["feeds"])

DIRECT_MEDIA_EXTENSIONS = (
    ".m3u8",
    ".mp4",
    ".mkv",
    ".webm",
    ".mov",
    ".avi",
    ".mjpeg",
    ".mjpg",
    ".ts",
    ".flv",
)
DIRECT_MEDIA_SCHEMES = {"rtsp", "rtsps", "rtmp", "rtmps", "srt", "udp", "tcp"}


def _is_direct_media_source(url: str) -> bool:
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return False
    scheme = (parsed.scheme or "").lower()
    if scheme in DIRECT_MEDIA_SCHEMES:
        return True
    if scheme in {"http", "https"}:
        lowered_path = (parsed.path or "").lower()
        return lowered_path.endswith(DIRECT_MEDIA_EXTENSIONS)
    return False


def _feed_validation_error() -> str:
    return (
        "Feeds require a direct RTSP, RTMP, SRT, UDP, TCP, or direct media URL such as an HLS .m3u8 file. "
        "Browser pages belong in Multigrid slots, not the background feed registry."
    )

@router.get("", response_model=list[FeedOut])
def list_feeds(db: Session = Depends(get_db)):
    feeds = db.query(Feed).order_by(Feed.id.asc()).all()
    out: list[FeedOut] = []
    for f in feeds:
        out.append(FeedOut(
            id=f.id, name=f.name, rtsp_url=f.rtsp_url, enabled=f.enabled,
            hls_url=f"{settings.mediamtx_hls_base}/{f.name}/index.m3u8"
        ))
    return out

@router.post("", response_model=FeedOut)
async def add_feed(feed: FeedCreate, db: Session = Depends(get_db)):
    if db.query(Feed).filter(Feed.name == feed.name).first():
        raise HTTPException(status_code=409, detail="Feed name already exists")
    if not _is_direct_media_source(feed.rtsp_url):
        raise HTTPException(status_code=422, detail=_feed_validation_error())
    f = Feed(name=feed.name, rtsp_url=feed.rtsp_url, enabled=feed.enabled)
    db.add(f)
    db.commit()
    db.refresh(f)

    await publish_event(
        topic="feeds.added",
        severity="INFO",
        source="api",
        payload={"name": f.name, "enabled": f.enabled}
    )

    return FeedOut(
        id=f.id, name=f.name, rtsp_url=f.rtsp_url, enabled=f.enabled,
        hls_url=f"{settings.mediamtx_hls_base}/{f.name}/index.m3u8"
    )

@router.post("/{feed_id}/toggle", response_model=FeedOut)
async def toggle_feed(feed_id: int, db: Session = Depends(get_db)):
    f = db.query(Feed).filter(Feed.id == feed_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Not found")
    if not f.enabled and not _is_direct_media_source(f.rtsp_url):
        raise HTTPException(status_code=422, detail=_feed_validation_error())
    f.enabled = not f.enabled
    db.commit()
    await publish_event("feeds.toggled", "INFO", "api", {"name": f.name, "enabled": f.enabled})
    return FeedOut(
        id=f.id, name=f.name, rtsp_url=f.rtsp_url, enabled=f.enabled,
        hls_url=f"{settings.mediamtx_hls_base}/{f.name}/index.m3u8"
    )
