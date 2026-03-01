import json
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import Event, Prediction
from ..schemas import EventOut, PredictionOut

router = APIRouter(prefix="/api", tags=["events"])

@router.get("/events", response_model=list[EventOut])
def list_events(limit: int = 200, db: Session = Depends(get_db)):
    rows = db.query(Event).order_by(Event.id.desc()).limit(min(limit, 1000)).all()
    out: list[EventOut] = []
    for e in rows:
        try:
            payload = json.loads(e.payload_json)
        except Exception:
            payload = e.payload_json
        out.append(EventOut(
            id=e.id, topic=e.topic, severity=e.severity, source=e.source,
            payload=payload, score=e.score, ts=e.ts.isoformat()
        ))
    return out

@router.get("/predictions", response_model=list[PredictionOut])
def list_predictions(limit: int = 200, db: Session = Depends(get_db)):
    rows = db.query(Prediction).order_by(Prediction.id.desc()).limit(min(limit, 1000)).all()
    return [
        PredictionOut(
            id=p.id, metric=p.metric, horizon_sec=p.horizon_sec,
            predicted=p.predicted, anomaly_score=p.anomaly_score, ts=p.ts.isoformat()
        ) for p in rows
    ]
