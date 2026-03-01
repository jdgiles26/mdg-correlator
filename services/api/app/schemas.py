from pydantic import BaseModel, Field
from typing import Any, Optional, Literal

class FeedCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=128)
    rtsp_url: str
    enabled: bool = True

class FeedOut(BaseModel):
    id: int
    name: str
    rtsp_url: str
    enabled: bool
    hls_url: str
    class Config:
        from_attributes = True

class IngestUrlIn(BaseModel):
    url: str

class EventOut(BaseModel):
    id: int
    topic: str
    severity: str
    source: str
    payload: Any
    score: Optional[float] = None
    ts: str

class PredictionOut(BaseModel):
    id: int
    metric: str
    horizon_sec: int
    predicted: float
    anomaly_score: float
    ts: str
