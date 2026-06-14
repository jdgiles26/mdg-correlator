from __future__ import annotations

import json
import time

from sqlalchemy.orm import Session

from .db import SessionLocal, engine
from .models import RuntimeConfig
from .settings import settings

RUNTIME_CONFIG_KEY = "ai"
_CACHE_TTL_SEC = 2.0
_cached_value: dict | None = None
_cached_at = 0.0
_table_ready = False


def _defaults() -> dict:
    return {
        "ollama_base_url": settings.ollama_base_url,
        "ollama_generate_model": settings.ollama_generate_model,
        "embeddings_enabled": settings.enable_embeddings,
        "background_inference_enabled": True,
        "background_inference_fps": 0.5,
        "background_detection_confidence": 0.45,
        "ui_detection_enabled": False,
        "ui_detection_fps": 1.0,
        "ui_detection_threshold": 0.45,
        "predictor_enabled": False,
        "predictor_min_events": 1,
        "predictor_min_anomaly_score": 0.7,
        "predictor_cooldown_sec": 120,
        "predictor_emit_empty_windows": False,
        "correlator_enabled": True,
        "correlator_min_score": 0.7,
        "correlator_cooldown_sec": 60,
        "ner_enabled": False,
        "task_alerts_enabled": True,
        "task_auto_report_enabled": True,
        "task_report_match_threshold": 0.35,
        "task_report_lookback_hours": 72,
        "task_report_max_events": 12,
        "task_event_cooldown_sec": 90,
    }


def _ensure_table() -> None:
    global _table_ready
    if _table_ready:
        return
    RuntimeConfig.__table__.create(bind=engine, checkfirst=True)
    _table_ready = True


def get_runtime_ai_settings(force: bool = False) -> dict:
    global _cached_at, _cached_value

    now = time.monotonic()
    if not force and _cached_value is not None and now - _cached_at < _CACHE_TTL_SEC:
        return _cached_value

    defaults = _defaults()
    try:
        _ensure_table()
        db: Session = SessionLocal()
        try:
            row = db.get(RuntimeConfig, RUNTIME_CONFIG_KEY)
        finally:
            db.close()
        if row is None:
            _cached_value = defaults
        else:
            try:
                payload = json.loads(row.value_json)
            except Exception:
                payload = {}
            _cached_value = {**defaults, **payload}
    except Exception:
        _cached_value = defaults

    _cached_at = now
    return _cached_value
