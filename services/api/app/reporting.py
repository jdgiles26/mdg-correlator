from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Chunk, Event, IngestObject, Task, TaskEvent, TaskReport
from .ollama import build_status, generate
from .runtime_settings import load_ai_settings
from .settings import settings

STOP_WORDS = {
    "about",
    "after",
    "alert",
    "also",
    "been",
    "before",
    "being",
    "from",
    "have",
    "into",
    "mission",
    "need",
    "next",
    "only",
    "over",
    "report",
    "task",
    "than",
    "that",
    "their",
    "there",
    "these",
    "they",
    "this",
    "threat",
    "with",
}
ALERT_TOPICS = {"anomaly.cluster", "predictor.forecast", "video.detections", "track.updated"}
EXCLUDED_CORRELATION_TOPICS = {
    "video.heartbeat",
    "task.created",
    "task.updated",
    "task.cancelled",
    "task.report.generated",
    "task.report.error",
    "task.alert",
    "correlator.start",
    "ner.start",
}
REPORT_SOURCE_LIMIT = 6
TASK_TRIGGER_TOPICS = {
    "video.detections",
    "anomaly.cluster",
    "predictor.forecast",
    "ingest.uploaded",
    "ingest.url",
    "ingest.url_text",
}

_embed_model = None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _safe_json(value: str | dict | list | None) -> Any:
    if value is None:
        return {}
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return {"raw": str(value)}


def _tokenize(text: str) -> list[str]:
    seen: set[str] = set()
    tokens: list[str] = []
    for token in re.findall(r"[a-zA-Z0-9][a-zA-Z0-9:_-]{2,}", text.lower()):
        if token in STOP_WORDS or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    return tokens


def _token_variants(token: str) -> set[str]:
    variants = {token}
    if token.endswith("ies") and len(token) > 4:
        variants.add(token[:-3] + "y")
    if token.endswith("s") and len(token) > 3:
        variants.add(token[:-1])
    elif not token.endswith("s") and len(token) > 2:
        variants.add(token + "s")
    return {value for value in variants if value}


def _token_set(text: str) -> set[str]:
    variants: set[str] = set()
    for token in _tokenize(text):
        variants.update(_token_variants(token))
    return variants


def _event_text(row: Event) -> str:
    return f"{row.topic} {row.severity} {row.source} {row.payload_json}".lower()


def _event_labels(payload: dict[str, Any]) -> set[str]:
    labels: set[str] = set()
    detections = payload.get("detections") or []
    for det in detections[:20]:
        label = det.get("label") or det.get("class") or det.get("class_name")
        if label:
            labels.add(str(label).lower())
    singular = payload.get("label")
    if singular:
        labels.add(str(singular).lower())
    return labels


def _event_feeds(payload: dict[str, Any]) -> set[str]:
    feeds: set[str] = set()
    feed = payload.get("feed")
    if isinstance(feed, str) and feed:
        feeds.add(feed.lower())
    for value in payload.get("feeds") or []:
        if isinstance(value, str) and value:
            feeds.add(value.lower())
    return feeds


def _risk_to_score(risk: str) -> float:
    return {
        "low": 0.2,
        "moderate": 0.45,
        "high": 0.72,
        "critical": 0.92,
    }.get(risk, 0.2)


def _resolve_generate_model(ai: dict[str, Any], status: dict[str, Any]) -> str | None:
    selected = ai.get("ollama_generate_model")
    if selected:
        return selected
    models = status.get("generate_models") or []
    return models[0] if models else None


def _get_embed_model():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer  # type: ignore

        _embed_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embed_model


def _semantic_source_matches(db: Session, query_text: str, threshold: float, limit: int) -> list[dict[str, Any]]:
    try:
        model = _get_embed_model()
        query_vector = model.encode(query_text, normalize_embeddings=True).tolist()
    except Exception:
        return []

    distance = Chunk.embedding.cosine_distance(query_vector)
    stmt = (
        select(Chunk, distance.label("distance"))
        .where(Chunk.embedding.is_not(None))
        .where(distance <= 1 - threshold)
        .order_by(distance)
        .limit(max(limit * 2, limit))
    )
    rows = db.execute(stmt).all()
    out: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = set()
    for chunk, distance_value in rows:
        key = (chunk.ingest_id, chunk.id)
        if key in seen:
            continue
        seen.add(key)
        score = round(max(-1.0, 1 - float(distance_value)), 4)
        out.append(
            {
                "ingest_id": chunk.ingest_id,
                "source_type": chunk.source_type,
                "source_label": chunk.source_label or f"ingest #{chunk.ingest_id}",
                "score": score,
                "excerpt": chunk.text[:320],
                "reason": "semantic search match",
            }
        )
    return out[:limit]


def _keyword_source_matches(db: Session, query_text: str, limit: int) -> list[dict[str, Any]]:
    tokens = list(_token_set(query_text))[:20]
    if not tokens:
        return []

    rows = (
        db.query(IngestObject)
        .order_by(IngestObject.created_at.desc())
        .limit(200)
        .all()
    )
    matches: list[dict[str, Any]] = []
    for row in rows:
        haystack = " ".join(
            filter(
                None,
                [
                    row.filename,
                    row.source_url,
                    row.content_type,
                    row.kind,
                ],
            )
        ).lower()
        matched_terms = [token for token in tokens if token in haystack]
        if not matched_terms:
            continue
        score = round(min(0.88, 0.22 + len(matched_terms) * 0.12), 4)
        matches.append(
            {
                "ingest_id": row.id,
                "source_type": row.kind,
                "source_label": row.source_url or row.filename,
                "score": score,
                "excerpt": row.filename[:320],
                "reason": f"metadata match on {', '.join(matched_terms[:4])}",
            }
        )
    matches.sort(key=lambda item: item["score"], reverse=True)
    return matches[:limit]


def _task_source_event_match(db: Session, source_event: Event | None) -> list[dict[str, Any]]:
    if source_event is None:
        return []
    payload = _safe_json(source_event.payload_json)
    ingest_id = payload.get("id")
    if not isinstance(ingest_id, int):
        return []
    row = db.query(IngestObject).filter(IngestObject.id == ingest_id).first()
    if row is None:
        return []
    return [
        {
            "ingest_id": row.id,
            "source_type": row.kind,
            "source_label": row.source_url or row.filename,
            "score": 0.95,
            "excerpt": row.filename[:320],
            "reason": f"directly linked from source event #{source_event.id}",
        }
    ]


def _merge_sources(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[int, str], dict[str, Any]] = {}
    for group in groups:
        for item in group:
            key = (int(item["ingest_id"]), str(item["source_label"]))
            existing = merged.get(key)
            if existing is None or float(item["score"]) > float(existing["score"]):
                merged[key] = dict(item)
            elif existing.get("reason") and item.get("reason") and item["reason"] not in existing["reason"]:
                existing["reason"] = f"{existing['reason']}; {item['reason']}"
    out = list(merged.values())
    out.sort(key=lambda item: float(item["score"]), reverse=True)
    return out[:REPORT_SOURCE_LIMIT]


def _find_related_sources(
    db: Session,
    task: Task,
    source_event: Event | None,
    ai: dict[str, Any],
) -> list[dict[str, Any]]:
    query_text = " ".join(filter(None, [task.title, task.description or ""]))
    if not query_text.strip():
        return _task_source_event_match(db, source_event)

    threshold = float(ai.get("task_report_match_threshold", 0.35))
    semantic_matches: list[dict[str, Any]] = []
    if ai.get("embeddings_enabled", settings.enable_embeddings) and settings.enable_embeddings:
        semantic_matches = _semantic_source_matches(db, query_text, threshold, REPORT_SOURCE_LIMIT)
    keyword_matches = _keyword_source_matches(db, query_text, REPORT_SOURCE_LIMIT)
    direct_matches = _task_source_event_match(db, source_event)
    return _merge_sources(direct_matches, semantic_matches, keyword_matches)


def _score_event_match(
    row: Event,
    query_tokens: list[str],
    source_payload: dict[str, Any],
) -> tuple[float, list[str], str]:
    text = _event_text(row)
    matched_terms = [token for token in query_tokens if token in text]
    score = min(0.35, len(matched_terms) * 0.08)

    if row.topic in {"anomaly.cluster", "predictor.forecast"}:
        score += 0.28
    elif row.topic in {"video.detections", "track.updated"}:
        score += 0.18
    elif row.topic.startswith("ingest."):
        score += 0.1

    if isinstance(row.score, (int, float)):
        score += min(0.22, float(row.score) * 0.25)

    payload = _safe_json(row.payload_json)
    source_feeds = _event_feeds(source_payload)
    row_feeds = _event_feeds(payload)
    if source_feeds and row_feeds and source_feeds.intersection(row_feeds):
        score += 0.2

    source_labels = _event_labels(source_payload)
    row_labels = _event_labels(payload)
    if source_labels and row_labels and source_labels.intersection(row_labels):
        score += 0.15

    source_ingest_id = source_payload.get("id")
    row_ingest_id = payload.get("id")
    if isinstance(source_ingest_id, int) and source_ingest_id == row_ingest_id:
        score += 0.25

    age_hours = 0.0
    if row.ts is not None:
        age_hours = max(0.0, (_now_utc() - row.ts.astimezone(timezone.utc)).total_seconds() / 3600.0)
    relation = "current" if age_hours <= 6 else "historical"
    return round(score, 4), matched_terms[:6], relation


def _find_correlated_events(
    db: Session,
    task: Task,
    source_event: Event | None,
    ai: dict[str, Any],
) -> list[dict[str, Any]]:
    lookback_hours = int(ai.get("task_report_lookback_hours", 72))
    max_events = int(ai.get("task_report_max_events", 12))
    cutoff = _now_utc() - timedelta(hours=max(1, lookback_hours))

    query_tokens = list(_token_set(" ".join(filter(None, [task.title, task.description or ""]))))
    source_payload = _safe_json(source_event.payload_json) if source_event else {}

    rows = (
        db.query(Event)
        .filter(Event.ts >= cutoff)
        .order_by(Event.id.desc())
        .limit(400)
        .all()
    )
    if source_event is not None and all(row.id != source_event.id for row in rows):
        rows.insert(0, source_event)

    correlated: list[dict[str, Any]] = []
    for row in rows:
        if row.topic in EXCLUDED_CORRELATION_TOPICS:
            continue
        score, matched_terms, relation = _score_event_match(row, query_tokens, source_payload)
        if source_event is not None and row.id == source_event.id:
            score = max(score, 0.7)
            relation = "source_event"
        if score < 0.18:
            continue

        payload = _safe_json(row.payload_json)
        correlated.append(
            {
                "id": row.id,
                "topic": row.topic,
                "severity": row.severity,
                "source": row.source,
                "score": row.score,
                "relevance_score": round(score, 4),
                "matched_terms": matched_terms,
                "temporal_relation": relation,
                "payload_preview": json.dumps(payload)[:280],
                "ts": row.ts.isoformat() if row.ts else None,
            }
        )

    correlated.sort(key=lambda item: (float(item["relevance_score"]), item.get("score") or 0.0), reverse=True)
    return correlated[:max_events]


def _assess_threat(
    task: Task,
    related_sources: list[dict[str, Any]],
    correlated_events: list[dict[str, Any]],
) -> tuple[bool, str, float, float]:
    signal_score = 0.0
    if task.priority == "critical":
        signal_score += 0.18
    elif task.priority == "high":
        signal_score += 0.1

    for event in correlated_events:
        topic = event["topic"]
        if topic == "anomaly.cluster":
            signal_score += 0.32
        elif topic == "predictor.forecast":
            signal_score += 0.24
        elif topic in {"video.detections", "track.updated"}:
            signal_score += 0.12
        elif topic.startswith("ingest."):
            signal_score += 0.08
        signal_score += min(0.06, float(event["relevance_score"]) * 0.08)
        if isinstance(event.get("score"), (int, float)):
            signal_score += min(0.08, float(event["score"]) * 0.08)

    if related_sources:
        signal_score += min(0.25, len(related_sources) * 0.05)
        signal_score += min(0.12, max(float(item["score"]) for item in related_sources) * 0.12)

    signal_score = min(1.0, signal_score)
    if signal_score >= 0.85:
        risk = "critical"
    elif signal_score >= 0.62:
        risk = "high"
    elif signal_score >= 0.34:
        risk = "moderate"
    else:
        risk = "low"

    threat_detected = bool(
        risk in {"moderate", "high", "critical"}
        or any(event["topic"] in ALERT_TOPICS for event in correlated_events)
    )
    confidence = min(
        0.95,
        0.3
        + len(correlated_events) * 0.04
        + len(related_sources) * 0.05
        + (0.12 if threat_detected else 0.0),
    )
    return threat_detected, risk, round(signal_score, 4), round(confidence, 4)


def _build_summary(
    task: Task,
    threat_detected: bool,
    risk: str,
    related_sources: list[dict[str, Any]],
    correlated_events: list[dict[str, Any]],
) -> str:
    if not related_sources and not correlated_events:
        return (
            f"Task '{task.title}' did not match recent ingested intelligence or correlated event activity. "
            f"Current assessed risk is {risk}."
        )

    parts = [
        f"Task '{task.title}' matched {len(related_sources)} intelligence source(s)",
        f"and {len(correlated_events)} correlated event(s).",
        f"Threat detected: {'yes' if threat_detected else 'no'}.",
        f"Assessed risk: {risk}.",
    ]
    return " ".join(parts)


def _recommend_next_steps(
    task: Task,
    threat_detected: bool,
    risk: str,
    related_sources: list[dict[str, Any]],
    correlated_events: list[dict[str, Any]],
) -> list[str]:
    steps: list[str] = []
    if correlated_events:
        steps.append("Review the correlated event timeline in the dashboard and confirm whether the activity is ongoing or historical.")
    if related_sources:
        steps.append("Open the matched ingested sources and validate that the task objective and evidence refer to the same actor, location, or object class.")
    if threat_detected:
        steps.append("Escalate the task to the watch floor or mission lead and assign an operator to disposition the alert.")
    else:
        steps.append("Keep the task open for monitoring until additional detections, anomaly clusters, or ingest matches appear.")
    if risk in {"high", "critical"}:
        steps.append("Generate a follow-on collection plan and verify whether additional feeds or OSINT sources cover the same area of interest.")
    if task.assignee:
        steps.append(f"Notify assignee {task.assignee} that the task intelligence report has been refreshed.")
    return steps[:5]


def _fallback_analysis(
    task: Task,
    threat_detected: bool,
    risk: str,
    risk_score: float,
    related_sources: list[dict[str, Any]],
    correlated_events: list[dict[str, Any]],
) -> str:
    if not correlated_events and not related_sources:
        return (
            f"No corroborating intelligence was found for task '{task.title}'. "
            "The report remains low-confidence and should be treated as a monitoring lead rather than a confirmed threat."
        )

    event_topics = ", ".join(dict.fromkeys(event["topic"] for event in correlated_events[:4]))
    top_source = related_sources[0]["source_label"] if related_sources else "none"
    return (
        f"Analyst assessment: task '{task.title}' has {'confirmed' if threat_detected else 'limited'} supporting evidence. "
        f"Risk is assessed as {risk} ({risk_score:.2f}). "
        f"Primary correlated signals: {event_topics or 'no major event topics'}. "
        f"Most relevant source: {top_source}. "
        "Correlations should be verified against operator context before taking action."
    )


def _generate_ai_analysis(
    ai: dict[str, Any],
    task: Task,
    source_event: Event | None,
    risk: str,
    risk_score: float,
    threat_detected: bool,
    related_sources: list[dict[str, Any]],
    correlated_events: list[dict[str, Any]],
    next_steps: list[str],
) -> tuple[str, str, str | None]:
    status = build_status(ai["ollama_base_url"], settings.ollama_timeout_sec)
    model = _resolve_generate_model(ai, status)
    if not status.get("reachable") or not model:
        return "", "heuristic", None

    source_event_line = "none"
    if source_event is not None:
        source_event_line = (
            f"#{source_event.id} {source_event.topic} {source_event.severity} {source_event.source} "
            f"{source_event.payload_json[:220]}"
        )

    prompt = (
        "Create a concise military-style intelligence assessment from the evidence below. "
        "Do not invent actors, intent, or correlations that are not supported by the evidence. "
        "Return two short paragraphs followed by a 'Recommended Actions:' bullet list.\n\n"
        f"Task: {task.title}\n"
        f"Description: {task.description or 'none'}\n"
        f"Priority: {task.priority}\n"
        f"Threat detected: {'yes' if threat_detected else 'no'}\n"
        f"Risk: {risk} ({risk_score:.2f})\n"
        f"Source event: {source_event_line}\n\n"
        "Related intelligence sources:\n"
        + "\n".join(
            f"- [{item['source_type']}] {item['source_label']} score={item['score']:.2f} reason={item['reason']} excerpt={item['excerpt'][:220]}"
            for item in related_sources[:5]
        )
        + "\n\nCorrelated events:\n"
        + "\n".join(
            f"- #{event['id']} {event['topic']} {event['severity']} source={event['source']} rel={event['relevance_score']:.2f} time={event['temporal_relation']} payload={event['payload_preview']}"
            for event in correlated_events[:6]
        )
        + "\n\nBaseline next steps:\n"
        + "\n".join(f"- {step}" for step in next_steps[:4])
    )

    try:
        analysis = generate(
            base_url=ai["ollama_base_url"],
            model=model,
            prompt=prompt,
            timeout_sec=settings.ollama_timeout_sec,
            system=(
                "You are a disciplined mission intelligence analyst. "
                "Stay grounded in the evidence. "
                "If evidence is weak, say so directly."
            ),
        )
        return analysis, "ollama", model
    except Exception:
        return "", "heuristic", None


def _build_markdown(
    task: Task,
    summary: str,
    threat_detected: bool,
    risk: str,
    risk_score: float,
    confidence_score: float,
    source_event: Event | None,
    related_sources: list[dict[str, Any]],
    correlated_events: list[dict[str, Any]],
    next_steps: list[str],
    settings_snapshot: dict[str, Any],
    analysis_text: str,
    generation_mode: str,
    model_name: str | None,
) -> str:
    lines = [
        "# Mission Intelligence Report",
        "",
        f"- Classification: UNCLASSIFIED",
        f"- Task ID: {task.id}",
        f"- Task Title: {task.title}",
        f"- Task Priority: {task.priority}",
        f"- Generated At: {_now_utc().isoformat()}",
        f"- Generation Mode: {generation_mode}",
        f"- Model: {model_name or 'heuristic-fallback'}",
        f"- Threat Detected: {'Yes' if threat_detected else 'No'}",
        f"- Threat Risk: {risk.upper()} ({risk_score:.2f})",
        f"- Confidence: {confidence_score:.2f}",
        "",
        "## Executive Summary",
        summary,
        "",
        "## Operational Context",
        f"- Status: {task.status}",
        f"- Assignee: {task.assignee or 'unassigned'}",
        f"- Source event: #{source_event.id} {source_event.topic}" if source_event is not None else "- Source event: none",
        f"- Description: {task.description or 'No task description provided.'}",
        "",
        "## Threat Analysis",
        analysis_text.strip() or "No AI narrative was generated. See the evidence sections below.",
        "",
        "## Correlated Events",
    ]
    if correlated_events:
        for event in correlated_events:
            lines.append(
                f"- #{event['id']} [{event['temporal_relation']}] {event['topic']} "
                f"severity={event['severity']} source={event['source']} "
                f"score={event['score'] if event['score'] is not None else 'n/a'} "
                f"relevance={event['relevance_score']:.2f} "
                f"matched_terms={', '.join(event['matched_terms']) or 'none'}"
            )
            lines.append(f"  payload: {event['payload_preview']}")
    else:
        lines.append("No correlated events were found in the configured lookback window.")

    lines.extend(["", "## Related Intelligence Sources"])
    if related_sources:
        for item in related_sources:
            lines.append(
                f"- ingest #{item['ingest_id']} [{item['source_type']}] {item['source_label']} "
                f"score={item['score']:.2f} reason={item['reason']}"
            )
            lines.append(f"  excerpt: {item['excerpt']}")
    else:
        lines.append("No ingested source matches were found for this task.")

    lines.extend(["", "## Recommended Next Steps"])
    for step in next_steps:
        lines.append(f"1. {step}")

    lines.extend(["", "## Settings In Effect"])
    for key, value in settings_snapshot.items():
        lines.append(f"- {key}: {value}")

    return "\n".join(lines).strip()


def evaluate_task_intelligence(db: Session, task: Task, driving_event: Event | None = None) -> dict[str, Any]:
    ai = load_ai_settings(db)
    source_event = driving_event
    if source_event is None and task.source_event_id:
        source_event = db.query(Event).filter(Event.id == task.source_event_id).first()

    related_sources = _find_related_sources(db, task, source_event, ai)
    correlated_events = _find_correlated_events(db, task, source_event, ai)
    threat_detected, risk, risk_score, confidence_score = _assess_threat(task, related_sources, correlated_events)
    summary = _build_summary(task, threat_detected, risk, related_sources, correlated_events)
    next_steps = _recommend_next_steps(task, threat_detected, risk, related_sources, correlated_events)
    ai_text, generation_mode, model_name = _generate_ai_analysis(
        ai,
        task,
        source_event,
        risk,
        risk_score,
        threat_detected,
        related_sources,
        correlated_events,
        next_steps,
    )
    analysis_text = ai_text or _fallback_analysis(
        task,
        threat_detected,
        risk,
        risk_score,
        related_sources,
        correlated_events,
    )
    settings_snapshot = {
        "task_alerts_enabled": ai.get("task_alerts_enabled", True),
        "task_auto_report_enabled": ai.get("task_auto_report_enabled", True),
        "task_report_match_threshold": ai.get("task_report_match_threshold", 0.35),
        "task_report_lookback_hours": ai.get("task_report_lookback_hours", 72),
        "task_report_max_events": ai.get("task_report_max_events", 12),
        "task_event_cooldown_sec": ai.get("task_event_cooldown_sec", 90),
        "embeddings_enabled": ai.get("embeddings_enabled", settings.enable_embeddings),
        "ollama_generate_model": ai.get("ollama_generate_model") or model_name or "auto",
    }
    markdown = _build_markdown(
        task=task,
        summary=summary,
        threat_detected=threat_detected,
        risk=risk,
        risk_score=risk_score,
        confidence_score=confidence_score,
        source_event=source_event,
        related_sources=related_sources,
        correlated_events=correlated_events,
        next_steps=next_steps,
        settings_snapshot=settings_snapshot,
        analysis_text=analysis_text,
        generation_mode=generation_mode,
        model_name=model_name,
    )
    should_alert = threat_detected or bool(related_sources or correlated_events)
    return {
        "task_id": task.id,
        "source_event_id": source_event.id if source_event is not None else task.source_event_id,
        "title": f"Task {task.id} threat assessment",
        "summary": summary,
        "threat_detected": threat_detected,
        "threat_risk": risk,
        "risk_score": risk_score,
        "confidence_score": confidence_score,
        "generation_mode": generation_mode,
        "model_name": model_name,
        "correlated_events_count": len(correlated_events),
        "related_sources_count": len(related_sources),
        "report_markdown": markdown,
        "report_payload": {
            "task": {
                "id": task.id,
                "title": task.title,
                "description": task.description,
                "status": task.status,
                "priority": task.priority,
                "assignee": task.assignee,
                "source_event_id": task.source_event_id,
            },
            "source_event": {
                "id": source_event.id,
                "topic": source_event.topic,
                "severity": source_event.severity,
                "source": source_event.source,
                "payload": _safe_json(source_event.payload_json),
                "ts": source_event.ts.isoformat() if source_event and source_event.ts else None,
            }
            if source_event is not None
            else None,
            "related_sources": related_sources,
            "correlated_events": correlated_events,
            "next_steps": next_steps,
            "settings_snapshot": settings_snapshot,
            "analysis_text": analysis_text,
        },
        "alert": {
            "task_id": task.id,
            "title": task.title,
            "summary": summary,
            "threat_detected": threat_detected,
            "risk": risk,
            "related_sources_count": len(related_sources),
            "correlated_events_count": len(correlated_events),
            "source_event_id": source_event.id if source_event is not None else task.source_event_id,
        },
        "alert_score": max(risk_score, _risk_to_score(risk)),
        "should_alert": should_alert,
    }


def persist_task_report(db: Session, task: Task, evaluation: dict[str, Any]) -> TaskReport:
    row = TaskReport(
        task_id=task.id,
        source_event_id=evaluation.get("source_event_id"),
        title=evaluation["title"],
        summary=evaluation["summary"],
        threat_detected=evaluation["threat_detected"],
        threat_risk=evaluation["threat_risk"],
        risk_score=evaluation["risk_score"],
        confidence_score=evaluation["confidence_score"],
        generation_mode=evaluation["generation_mode"],
        model_name=evaluation["model_name"],
        correlated_events_count=evaluation["correlated_events_count"],
        related_sources_count=evaluation["related_sources_count"],
        report_markdown=evaluation["report_markdown"],
        report_json=json.dumps(evaluation["report_payload"], sort_keys=True, default=str),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _event_match_text(row: Event) -> str:
    payload = _safe_json(row.payload_json)
    parts: list[str] = [row.topic, row.severity, row.source]
    for key in ("feed", "url", "filename", "content_type", "kind", "name", "title", "summary", "source_url"):
        value = payload.get(key)
        if isinstance(value, str):
            parts.append(value)
    for det in payload.get("detections") or []:
        for key in ("label", "class", "class_name"):
            value = det.get(key)
            if isinstance(value, str):
                parts.append(value)
    return " ".join(parts)


def _score_task_event_match(task: Task, row: Event) -> tuple[float, list[str]]:
    task_tokens = _token_set(" ".join(filter(None, [task.title, task.description or ""])))
    if not task_tokens:
        return 0.0, []

    event_tokens = _token_set(_event_match_text(row))
    matches = sorted(task_tokens.intersection(event_tokens))
    score = min(0.8, len(matches) * 0.16)

    if row.topic == "video.detections":
        labels = _event_labels(_safe_json(row.payload_json))
        expanded_labels: set[str] = set()
        for label in labels:
            expanded_labels.update(_token_variants(label))
        if task_tokens.intersection(expanded_labels):
            score += 0.45
    elif row.topic.startswith("ingest."):
        score += 0.12
    elif row.topic in {"anomaly.cluster", "predictor.forecast"}:
        score += 0.18

    if isinstance(row.score, (int, float)):
        score += min(0.12, float(row.score) * 0.12)

    return min(score, 1.0), matches[:6]


def process_event_task_matches(db: Session, row: Event) -> list[dict[str, Any]]:
    if row.topic not in TASK_TRIGGER_TOPICS:
        return []

    ai = load_ai_settings(db)
    if not ai.get("task_alerts_enabled", True) and not ai.get("task_auto_report_enabled", True):
        return []

    cooldown_sec = int(ai.get("task_event_cooldown_sec", 90))
    tasks = (
        db.query(Task)
        .filter(Task.status.in_(["open", "in_progress"]))
        .filter(Task.priority.in_(["high", "critical"]))
        .order_by(Task.created_at.desc())
        .all()
    )

    matches_out: list[dict[str, Any]] = []
    for task in tasks:
        match_score, matched_terms = _score_task_event_match(task, row)
        if match_score < 0.45:
            continue

        last_report = (
            db.query(TaskReport)
            .filter(TaskReport.task_id == task.id)
            .order_by(TaskReport.created_at.desc(), TaskReport.id.desc())
            .first()
        )
        if (
            last_report is not None
            and last_report.source_event_id is not None
            and last_report.created_at is not None
            and row.ts is not None
            and (row.ts.astimezone(timezone.utc) - last_report.created_at.astimezone(timezone.utc)).total_seconds() < cooldown_sec
        ):
            continue

        evaluation = evaluate_task_intelligence(db, task, driving_event=row)
        report = None
        if ai.get("task_auto_report_enabled", True):
            report = persist_task_report(db, task, evaluation)

        detail = (
            f"Auto-matched event #{row.id} ({row.topic})"
            + (f" on terms: {', '.join(matched_terms)}" if matched_terms else "")
        )
        db.add(TaskEvent(task_id=task.id, actor="system", action="auto_alert", detail=detail))
        db.commit()

        matches_out.append(
            {
                "task": task,
                "event": row,
                "evaluation": evaluation,
                "report": report,
            }
        )

    return matches_out


def task_report_to_dict(report: TaskReport, include_body: bool = False) -> dict[str, Any]:
    payload = _safe_json(report.report_json) if include_body else None
    return {
        "id": report.id,
        "task_id": report.task_id,
        "source_event_id": report.source_event_id,
        "report_type": report.report_type,
        "title": report.title,
        "summary": report.summary,
        "threat_detected": report.threat_detected,
        "threat_risk": report.threat_risk,
        "risk_score": report.risk_score,
        "confidence_score": report.confidence_score,
        "generation_mode": report.generation_mode,
        "model_name": report.model_name,
        "correlated_events_count": report.correlated_events_count,
        "related_sources_count": report.related_sources_count,
        "report_markdown": report.report_markdown if include_body else None,
        "report_payload": payload,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "updated_at": report.updated_at.isoformat() if report.updated_at else None,
    }
