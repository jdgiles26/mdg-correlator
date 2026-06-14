import json
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .models import RuntimeConfig
from .settings import settings

RUNTIME_CONFIG_KEY = "ai"


class AISettings(BaseModel):
    ollama_base_url: str = settings.ollama_base_url
    ollama_generate_model: str | None = settings.ollama_generate_model
    embeddings_enabled: bool = settings.enable_embeddings
    background_inference_enabled: bool = True
    background_inference_fps: float = Field(default=0.5, ge=0.2, le=5.0)
    background_detection_confidence: float = Field(default=0.45, ge=0.05, le=0.99)
    ui_detection_enabled: bool = False
    ui_detection_fps: float = Field(default=1.0, ge=0.2, le=5.0)
    ui_detection_threshold: float = Field(default=0.45, ge=0.05, le=0.99)
    predictor_enabled: bool = False
    predictor_min_events: int = Field(default=1, ge=1, le=100)
    predictor_min_anomaly_score: float = Field(default=0.7, ge=0.0, le=1.0)
    predictor_cooldown_sec: int = Field(default=120, ge=0, le=3600)
    predictor_emit_empty_windows: bool = False
    correlator_enabled: bool = True
    correlator_min_score: float = Field(default=0.7, ge=0.0, le=1.0)
    correlator_cooldown_sec: int = Field(default=60, ge=0, le=3600)
    ner_enabled: bool = False
    task_alerts_enabled: bool = True
    task_auto_report_enabled: bool = True
    task_report_match_threshold: float = Field(default=0.35, ge=0.05, le=0.99)
    task_report_lookback_hours: int = Field(default=72, ge=1, le=720)
    task_report_max_events: int = Field(default=12, ge=1, le=50)
    task_event_cooldown_sec: int = Field(default=90, ge=0, le=3600)


def get_default_ai_settings() -> dict:
    return AISettings().model_dump()


def load_ai_settings(db: Session) -> dict:
    defaults = get_default_ai_settings()
    row = db.get(RuntimeConfig, RUNTIME_CONFIG_KEY)
    if not row:
        return defaults

    try:
        raw = json.loads(row.value_json)
    except Exception:
        return defaults

    merged = {**defaults, **raw}
    return AISettings(**merged).model_dump()


def save_ai_settings(db: Session, payload: dict) -> dict:
    settings_payload = AISettings(**payload).model_dump()
    row = db.get(RuntimeConfig, RUNTIME_CONFIG_KEY)
    if row is None:
        row = RuntimeConfig(
            key=RUNTIME_CONFIG_KEY,
            value_json=json.dumps(settings_payload, sort_keys=True),
        )
        db.add(row)
    else:
        row.value_json = json.dumps(settings_payload, sort_keys=True)
    db.commit()
    db.refresh(row)
    return settings_payload
