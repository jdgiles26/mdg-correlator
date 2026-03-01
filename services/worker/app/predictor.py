import asyncio
import json
import math
import time
from collections import defaultdict, deque

from sqlalchemy.orm import Session
from .db import SessionLocal
from .models import Prediction
from .nats_bus import publish, nc, EVENT_SUBJECT

class EWMA:
    def __init__(self, alpha: float = 0.2):
        self.alpha = alpha
        self.mu = None
        self.var = 1.0

    def update(self, x: float):
        if self.mu is None:
            self.mu = x
            self.var = 1.0
            return
        prev = self.mu
        self.mu = self.alpha * x + (1 - self.alpha) * self.mu
        # EW variance-ish
        self.var = self.alpha * (x - prev) ** 2 + (1 - self.alpha) * self.var

    def zscore(self, x: float) -> float:
        if self.mu is None:
            return 0.0
        return (x - self.mu) / max(1e-6, math.sqrt(self.var))

async def predictor_loop(stop_event: asyncio.Event):
    # Track event counts per feed over rolling windows; emit predictions.
    stats = defaultdict(lambda: EWMA(alpha=0.25))
    counts = defaultdict(int)
    last_emit = time.time()

    c = await nc()
    sub = await c.subscribe(EVENT_SUBJECT)

    async def persist(metric: str, predicted: float, anomaly_score: float, horizon_sec: int = 300):
        db: Session = SessionLocal()
        try:
            p = Prediction(metric=metric, horizon_sec=horizon_sec, predicted=float(predicted), anomaly_score=float(anomaly_score))
            db.add(p)
            db.commit()
        finally:
            db.close()

    while not stop_event.is_set():
        try:
            msg = await sub.next_msg(timeout=1)
        except asyncio.TimeoutError:
            msg = None

        now = time.time()

        if msg:
            try:
                obj = json.loads(msg.data.decode("utf-8"))
                if obj.get("topic") == "video.detections":
                    feed = (obj.get("payload") or {}).get("feed", "unknown")
                    counts[feed] += 1
            except Exception:
                pass

        # Every 30s, update EWMA and emit prediction
        if now - last_emit >= 30:
            last_emit = now
            for feed, ccount in list(counts.items()):
                metric = f"events.detections_per_30s.{feed}"
                model = stats[metric]
                model.update(ccount)
                z = model.zscore(ccount)
                anomaly = float(min(1.0, abs(z) / 4.0))
                predicted = float(model.mu if model.mu is not None else ccount)
                await persist(metric, predicted, anomaly, horizon_sec=30)
                await publish("predictor.forecast", "INFO", "predictor", {
                    "metric": metric,
                    "window_sec": 30,
                    "observed": ccount,
                    "predicted": predicted,
                    "zscore": z
                }, score=anomaly)
                counts[feed] = 0
