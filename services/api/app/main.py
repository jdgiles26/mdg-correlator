"""
Federated Mission Data Grid — API server.

Routers
-------
/api/feeds       — RTSP feed registry
/api/ingest      — file upload + URL ingest
/api/events      — event stream WebSocket + REST
/api/graph       — knowledge-graph entities + edges + traversal
/api/search      — semantic search (Qdrant, requires ENABLE_EMBEDDINGS=true)
/api/tasks       — operator tasking workflow
/api/audit       — append-only audit log

Middleware
----------
AuditMiddleware  — writes an AuditLog row for every non-GET request
"""
import asyncio
import json
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session

from .settings import settings
from .db import engine, SessionLocal
from .models import Base, Event, AuditLog
from .routers.feeds import router as feeds_router
from .routers.ingest import router as ingest_router
from .routers.events import router as events_router
from .routers.graph import router as graph_router
from .routers.search import router as search_router
from .routers.tasks import router as tasks_router
from .routers.audit import router as audit_router
from .events_bus import subscribe_events


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    task = asyncio.create_task(_persist_events_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title=settings.app_name, version="2.0.0", lifespan=lifespan)

# ─── CORS ─────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Audit middleware ─────────────────────────────────────────────────────────

class AuditMiddleware(BaseHTTPMiddleware):
    """
    Write an AuditLog row for every mutating request (POST/PUT/PATCH/DELETE).
    GETs and health checks are not audited.
    """
    SKIP_PATHS = {"/healthz", "/openapi.json", "/docs", "/redoc"}

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        if (
            request.method not in ("GET", "HEAD", "OPTIONS")
            and request.url.path not in self.SKIP_PATHS
        ):
            db: Optional[Session] = None
            try:
                db = SessionLocal()
                actor = request.headers.get("X-Actor", "anonymous")
                reason = request.headers.get("X-Reason", None)
                row = AuditLog(
                    actor=actor,
                    action=f"{request.method} {request.url.path}",
                    http_method=request.method,
                    path=str(request.url.path),
                    ip=request.client.host if request.client else None,
                    reason=reason,
                    status_code=response.status_code,
                    result="allow" if response.status_code < 400 else "deny",
                )
                assert db is not None
                db.add(row)
                db.commit()
            except Exception:
                pass
            finally:
                if db is not None:
                    try:
                        db.close()
                    except Exception:
                        pass

        return response


app.add_middleware(AuditMiddleware)

# ─── Routers ──────────────────────────────────────────────────────────────────

app.include_router(feeds_router)
app.include_router(ingest_router)
app.include_router(events_router)
app.include_router(graph_router)
app.include_router(search_router)
app.include_router(tasks_router)
app.include_router(audit_router)

# ─── Background loop ──────────────────────────────────────────────────────────

async def _persist_events_loop():
    while True:
        try:
            async for msg in subscribe_events():
                try:
                    topic = msg.get("topic", "unknown")
                    severity = msg.get("severity", "INFO")
                    source = msg.get("source", "unknown")
                    payload = msg.get("payload", {})
                    score = msg.get("score", None)
                    db: Session = SessionLocal()
                    try:
                        ev = Event(
                            topic=topic,
                            severity=severity,
                            source=source,
                            payload_json=json.dumps(payload),
                            score=score,
                        )
                        db.add(ev)
                        db.commit()
                    finally:
                        db.close()
                except Exception:
                    pass
        except Exception:
            await asyncio.sleep(1)

# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/healthz")
def healthz():
    return {"ok": True, "version": "2.0.0"}

# ─── WebSocket event stream ───────────────────────────────────────────────────

@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    await ws.accept()
    try:
        async for msg in subscribe_events():
            await ws.send_text(json.dumps(msg))
    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await ws.close()
        except Exception:
            pass
