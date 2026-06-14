import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Event, Task, TaskReport
from ..ollama import build_status
from ..routers import detect as detect_runtime
from ..runtime_settings import load_ai_settings
from ..settings import settings

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/status")
def system_status(db: Session = Depends(get_db)):
    ai = load_ai_settings(db)
    ollama = build_status(ai["ollama_base_url"], settings.ollama_timeout_sec)

    issue_topics = ["feeds.connection_issue", "video.infer.error", "feeds.start_error"]
    issue_rows = (
        db.query(Event)
        .filter(Event.topic.in_(issue_topics))
        .order_by(Event.id.desc())
        .limit(60)
        .all()
    )
    latest_by_feed: dict[str, dict] = {}
    for row in issue_rows:
        try:
            payload = json.loads(row.payload_json)
        except Exception:
            payload = {"raw": row.payload_json}
        feed_name = payload.get("name") or payload.get("feed") or row.source
        if feed_name in latest_by_feed:
            continue
        latest_by_feed[feed_name] = {
            "feed": feed_name,
            "topic": row.topic,
            "severity": row.severity,
            "error": payload.get("error") or payload.get("raw") or "Unknown issue",
            "hint": payload.get("hint"),
            "ts": row.ts.isoformat() if row.ts else None,
        }

    open_high_priority = (
        db.query(Task)
        .filter(Task.status.in_(["open", "in_progress"]))
        .filter(Task.priority.in_(["high", "critical"]))
        .count()
    )
    report_count = db.query(TaskReport).count()

    return {
        "api": {"ok": True, "version": "2.0.0"},
        "ollama": {
            "reachable": ollama.get("reachable", False),
            "base_url": ollama.get("base_url"),
            "model": ai.get("ollama_generate_model"),
            "generate_models": ollama.get("generate_models") or [],
            "error": ollama.get("error"),
        },
        "detections": {
            "mediapipe_available": detect_runtime.MEDIAPIPE_AVAILABLE,
            "pil_available": detect_runtime.PIL_AVAILABLE,
            "model_loaded": detect_runtime._detection_model is not None,
            "ui_detection_enabled": ai.get("ui_detection_enabled", False),
            "background_inference_enabled": ai.get("background_inference_enabled", True),
        },
        "runtime": {
            "embeddings_enabled": ai.get("embeddings_enabled", settings.enable_embeddings),
            "task_alerts_enabled": ai.get("task_alerts_enabled", True),
            "task_auto_report_enabled": ai.get("task_auto_report_enabled", True),
            "report_generation_ready": bool(ollama.get("reachable") and (ai.get("ollama_generate_model") or ollama.get("generate_models"))),
            "open_high_priority_tasks": open_high_priority,
            "saved_reports": report_count,
        },
        "feed_issues": list(latest_by_feed.values()),
    }
