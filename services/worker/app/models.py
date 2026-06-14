"""
Worker-side SQLAlchemy models.
Must stay in sync with the API-side models.py for shared tables.
"""
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import (
    String, Boolean, DateTime, Float, Text, Integer, ForeignKey, Index
)
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector


class Base(DeclarativeBase):
    pass


class Feed(Base):
    __tablename__ = "feeds"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    rtsp_url: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())


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


class IngestObject(Base):
    """Minimal view of ingest_objects used by the embed worker."""
    __tablename__ = "ingest_objects"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32))
    filename: Mapped[str] = mapped_column(String(512))
    content_type: Mapped[str] = mapped_column(String(128))
    object_key: Mapped[str] = mapped_column(String(1024), unique=True, index=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Chunk(Base):
    """Text chunk stored in Postgres with an in-row pgvector embedding."""
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
    ingest_id: Mapped[int] = mapped_column(Integer, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(384), nullable=True)
    source_type: Mapped[str] = mapped_column(String(32), default="document", index=True)
    source_label: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Entity(Base):
    """Knowledge-graph entity node (worker-side)."""
    __tablename__ = "entities"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(512), index=True)
    external_id: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    attributes: Mapped[str | None] = mapped_column(Text, nullable=True)   # JSON
    source_ingest_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_event_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Edge(Base):
    """Directed relationship between entity nodes (worker-side)."""
    __tablename__ = "edges"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    src_id: Mapped[int] = mapped_column(Integer, index=True)
    dst_id: Mapped[int] = mapped_column(Integer, index=True)
    relation: Mapped[str] = mapped_column(String(64), index=True)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    attributes: Mapped[str | None] = mapped_column(Text, nullable=True)   # JSON
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
