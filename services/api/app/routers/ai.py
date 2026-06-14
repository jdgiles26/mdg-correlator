from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Event
from ..ollama import build_status, ensure_generate_model_available, generate
from ..runtime_settings import AISettings, load_ai_settings, save_ai_settings
from ..settings import settings

router = APIRouter(prefix="/api/ai", tags=["ai"])


class SearchAnswerIn(BaseModel):
    query: str = Field(..., min_length=2, max_length=500)
    context: list[str] = Field(default_factory=list)


def _with_resolved_model(current: dict[str, Any], status: dict[str, Any]) -> dict[str, Any]:
    resolved = dict(current)
    if not resolved.get("ollama_generate_model") and status.get("generate_models"):
        preferred_prefixes = (
            "llama3.2",
            "mistral",
            "gemma3",
            "phi3",
            "gpt-oss",
            "qwen2.5",
            "qwen3",
        )
        for prefix in preferred_prefixes:
            match = next((name for name in status["generate_models"] if name.startswith(prefix)), None)
            if match:
                resolved["ollama_generate_model"] = match
                break
        else:
            resolved["ollama_generate_model"] = status["generate_models"][0]
    return resolved


def _brief_prompt(rows: list[Event]) -> str:
    if not rows:
        return "No recent persisted events are available."

    lines = []
    for row in rows:
        lines.append(
            f"- topic={row.topic} severity={row.severity} source={row.source} score={row.score!r} payload={row.payload_json[:280]}"
        )
    return (
        "Summarize the recent mission-grid activity for an operator. "
        "Focus on actionable anomalies, suppress repeated low-signal chatter, "
        "and explicitly say when there is no real alert pattern.\n\n"
        "Recent events:\n"
        + "\n".join(lines)
    )


@router.get("/settings")
def get_ai_settings(db: Session = Depends(get_db)):
    current = load_ai_settings(db)
    status = build_status(current["ollama_base_url"], settings.ollama_timeout_sec)
    resolved = _with_resolved_model(current, status)
    return {"settings": resolved, "ollama": status}


@router.put("/settings")
def put_ai_settings(body: AISettings, db: Session = Depends(get_db)):
    payload = body.model_dump()
    status = build_status(payload["ollama_base_url"], settings.ollama_timeout_sec)
    if status.get("reachable"):
        try:
            ensure_generate_model_available(status, payload.get("ollama_generate_model"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    elif payload.get("ollama_generate_model"):
        raise HTTPException(
            status_code=400,
            detail="Cannot validate the selected Ollama model because the local Ollama endpoint is unreachable.",
        )

    saved = save_ai_settings(db, payload)
    resolved = _with_resolved_model(saved, status)
    return {"settings": resolved, "ollama": status}


@router.get("/ollama/status")
def get_ollama_status(base_url: str | None = None, db: Session = Depends(get_db)):
    current = load_ai_settings(db)
    target = base_url or current["ollama_base_url"]
    return build_status(target, settings.ollama_timeout_sec)


@router.get("/brief")
def generate_brief(limit: int = 20, db: Session = Depends(get_db)):
    current = load_ai_settings(db)
    status = build_status(current["ollama_base_url"], settings.ollama_timeout_sec)
    resolved = _with_resolved_model(current, status)
    model = resolved.get("ollama_generate_model")
    if not status.get("reachable"):
        raise HTTPException(status_code=503, detail=status.get("error") or "Ollama is not reachable.")
    if not model:
        raise HTTPException(status_code=400, detail="No local Ollama generate model is available.")

    rows = (
        db.query(Event)
        .filter(Event.topic.notin_(["video.heartbeat"]))
        .order_by(Event.id.desc())
        .limit(max(1, min(limit, 100)))
        .all()
    )
    rows.reverse()

    try:
        summary = generate(
            base_url=resolved["ollama_base_url"],
            model=model,
            prompt=_brief_prompt(rows),
            timeout_sec=settings.ollama_timeout_sec,
            system=(
                "You are a terse operations analyst. "
                "Do not invent threats. "
                "If the input is just routine detections or empty windows, say so plainly."
            ),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Ollama brief failed: {exc}")

    return {
        "model": model,
        "summary": summary,
        "events_considered": len(rows),
    }


@router.post("/search-answer")
def generate_search_answer(body: SearchAnswerIn, db: Session = Depends(get_db)):
    current = load_ai_settings(db)
    status = build_status(current["ollama_base_url"], settings.ollama_timeout_sec)
    resolved = _with_resolved_model(current, status)
    model = resolved.get("ollama_generate_model")
    if not status.get("reachable"):
        raise HTTPException(status_code=503, detail=status.get("error") or "Ollama is not reachable.")
    if not model:
        raise HTTPException(status_code=400, detail="No local Ollama generate model is available.")
    if not body.context:
        raise HTTPException(status_code=400, detail="Search context is empty.")

    prompt = (
        f"Question: {body.query.strip()}\n\n"
        "Answer strictly from the provided search context. "
        "If the context is insufficient, say that directly.\n\n"
        "Context:\n"
        + "\n\n".join(f"[{idx + 1}] {text[:1200]}" for idx, text in enumerate(body.context[:8]))
    )
    try:
        answer = generate(
            base_url=resolved["ollama_base_url"],
            model=model,
            prompt=prompt,
            timeout_sec=settings.ollama_timeout_sec,
            system="You answer using only the supplied mission-grid search evidence.",
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Ollama answer failed: {exc}")

    return {"model": model, "answer": answer}
