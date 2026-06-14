"""
SQLAlchemy ORM models for the Federated Mission Data Grid.

Tables
------
feeds           — registered RTSP camera/stream feeds
ingest_objects  — raw uploads / URL ingests stored in MinIO
events          — NATS event log (all bus traffic persisted)
predictions     — anomaly prediction timeseries
entities        — knowledge-graph entity nodes (asset, sensor, document, …)
edges           — knowledge-graph relationships between entities
chunks          — text chunks linked to ingest_objects, embedded into Postgres
tasks           — operator tasking workflow (alerts → actions → dispositions)
task_events     — immutable audit trail for task state transitions
task_reports    — persisted AI-assisted task intelligence reports
audit_log       — immutable per-request audit log (policy layer)
"""
from sqlalchemy import (
    String, Boolean, DateTime, Float, ForeignKey,
    Text, Integer, JSON, Index
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector
from .db import Base


# ─── Existing tables ──────────────────────────────────────────────────────────

class Feed(Base):
    __tablename__ = "feeds"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    rtsp_url: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Policy fields
    allowed_roles: Mapped[str | None] = mapped_column(Text, nullable=True)   # comma-sep list; NULL = unrestricted
    classification: Mapped[str] = mapped_column(String(32), default="UNCLASSIFIED")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class IngestObject(Base):
    __tablename__ = "ingest_objects"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32))  # document|audio|video|url|osint
    filename: Mapped[str] = mapped_column(String(512))
    content_type: Mapped[str] = mapped_column(String(128))
    object_key: Mapped[str] = mapped_column(String(1024), unique=True, index=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    ts: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    topic: Mapped[str] = mapped_column(String(128), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="INFO")
    source: Mapped[str] = mapped_column(String(256), default="system")
    payload_json: Mapped[str] = mapped_column(Text)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)


class Prediction(Base):
    __tablename__ = "predictions"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    ts: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    metric: Mapped[str] = mapped_column(String(128), index=True)
    horizon_sec: Mapped[int] = mapped_column(default=300)
    predicted: Mapped[float] = mapped_column(Float)
    anomaly_score: Mapped[float] = mapped_column(Float)


class RuntimeConfig(Base):
    __tablename__ = "runtime_config"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ─── Knowledge-graph layer ────────────────────────────────────────────────────

class Entity(Base):
    """
    Ontology entity node.

    entity_type: Asset | Sensor | Feed | Observation | Track | Event |
                 Location | Mission | Task | Actor | Document | Media
    """
    __tablename__ = "entities"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(512), index=True)
    external_id: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    # Flexible JSON payload (geo, metadata, attributes)
    attributes: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    # Optional link back to the source object
    source_ingest_id: Mapped[int | None] = mapped_column(ForeignKey("ingest_objects.id"), nullable=True)
    source_event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id"), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Edge(Base):
    """
    Directed relationship between two Entity nodes.

    Examples:
      Asset      HAS_SENSOR     Sensor
      Sensor     PRODUCED       Observation
      Observation SUPPORTS      Track
      Track      OCCURS_AT      Location
      Event      TRIGGERED_BY   Observation
      Task       CREATED_FROM   Event
      Task       ASSIGNED_TO    Actor
    """
    __tablename__ = "edges"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    src_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    dst_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    relation: Mapped[str] = mapped_column(String(64), index=True)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    attributes: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


# ─── Text chunk / embedding index ────────────────────────────────────────────

class Chunk(Base):
    """
    Text chunk derived from an IngestObject.
    The vector is stored alongside the chunk in Postgres via pgvector.
    """
    __tablename__ = "chunks"
    __table_args__ = (
        Index(
            "ix_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    ingest_id: Mapped[int] = mapped_column(ForeignKey("ingest_objects.id"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(384), nullable=True)
    source_type: Mapped[str] = mapped_column(String(32), default="document", index=True)  # osint|document|url|event
    source_label: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


# ─── Tasking workflow ─────────────────────────────────────────────────────────

class Task(Base):
    """
    Operator task created from an alert/event.

    status: open | in_progress | closed | cancelled
    priority: low | normal | high | critical
    """
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="open", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="normal", index=True)
    # Created from event / entity
    source_event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id"), nullable=True)
    source_entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"), nullable=True)
    # Assignment
    assignee: Mapped[str | None] = mapped_column(String(256), nullable=True)
    due_ts: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Resolution
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome_event_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"), nullable=True)
    created_by: Mapped[str] = mapped_column(String(256), default="operator")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TaskEvent(Base):
    """Immutable audit trail for task state transitions."""
    __tablename__ = "task_events"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    actor: Mapped[str] = mapped_column(String(256), default="operator")
    action: Mapped[str] = mapped_column(String(64))   # created | status_change | note | assigned | closed
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    ts: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class TaskReport(Base):
    """
    Persisted task intelligence report generated from ingested sources and event correlation.
    """
    __tablename__ = "task_reports"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    source_event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id"), nullable=True)
    report_type: Mapped[str] = mapped_column(String(64), default="threat_assessment", index=True)
    title: Mapped[str] = mapped_column(String(512))
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    threat_detected: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    threat_risk: Mapped[str] = mapped_column(String(32), default="low", index=True)
    risk_score: Mapped[float] = mapped_column(Float, default=0.0)
    confidence_score: Mapped[float] = mapped_column(Float, default=0.0)
    generation_mode: Mapped[str] = mapped_column(String(32), default="heuristic")
    model_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    correlated_events_count: Mapped[int] = mapped_column(Integer, default=0)
    related_sources_count: Mapped[int] = mapped_column(Integer, default=0)
    report_markdown: Mapped[str] = mapped_column(Text)
    report_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ─── Policy / audit ───────────────────────────────────────────────────────────

class AuditLog(Base):
    """
    Immutable audit log row written on every sensitive API call.
    Never updated, never deleted.
    """
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    ts: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor: Mapped[str] = mapped_column(String(256), index=True)         # user/service identity
    action: Mapped[str] = mapped_column(String(128), index=True)        # e.g. feed.read, ingest.upload
    resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)     # operator-supplied reason code
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    http_method: Mapped[str | None] = mapped_column(String(8), nullable=True)
    path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result: Mapped[str] = mapped_column(String(16), default="allow")    # allow | deny
