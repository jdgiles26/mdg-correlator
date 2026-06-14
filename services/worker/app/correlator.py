"""
Track correlator — "make sense" layer.

Groups detection events into tracklets by:
  - Same feed + overlapping time window (30s)
  - Same dominant label class

Emits:
  track.updated   { track_id, feed, label, detections_count, first_ts, last_ts, peak_score }
  anomaly.cluster { feeds, cluster_size, avg_score, window_start, window_end }

Also creates Track and Observation entities in the graph.
"""
import asyncio
import json
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List

from .db import SessionLocal
from .nats_bus import publish
from .settings import settings
from .runtime_settings import get_runtime_ai_settings

TRACK_WINDOW_SEC = 30     # seconds of inactivity to close a track
ANOMALY_WINDOW_SEC = 60   # rolling window for cross-feed anomaly correlation
ANOMALY_MIN_FEEDS = 2     # minimum feeds firing at same time to raise cluster


@dataclass
class TrackState:
    feed: str
    label: str
    start_ts: float = field(default_factory=time.time)
    last_ts: float = field(default_factory=time.time)
    count: int = 0
    peak_score: float = 0.0
    track_id: str = ""

    def __post_init__(self):
        import uuid
        if not self.track_id:
            self.track_id = uuid.uuid4().hex[:12]


def _store_track_entity(track: TrackState):
    """Persist the track as a Track entity and link to its feed."""
    try:
        from .models import Entity, Edge
        db = SessionLocal()
        try:
            # Get or create feed entity
            feed_ent = (
                db.query(Entity).filter(Entity.entity_type == "Feed", Entity.name == track.feed).first()
            )
            if not feed_ent:
                feed_ent = Entity(entity_type="Feed", name=track.feed, confidence=1.0)
                db.add(feed_ent)
                db.flush()

            import json as _json
            attrs = _json.dumps({
                "track_id": track.track_id,
                "start_ts": track.start_ts,
                "last_ts": track.last_ts,
                "count": track.count,
                "peak_score": track.peak_score,
            })
            track_ent = Entity(
                entity_type="Track",
                name=f"Track {track.track_id} [{track.label}]",
                external_id=track.track_id,
                attributes=attrs,
                confidence=track.peak_score,
            )
            db.add(track_ent)
            db.flush()

            db.add(Edge(src_id=feed_ent.id, dst_id=track_ent.id, relation="PRODUCED", confidence=0.9))
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
    except Exception:
        pass


class Correlator:
    def __init__(self):
        # Active tracks: key = (feed, label)
        self.tracks: Dict[tuple, TrackState] = {}
        # Recent high-score events for anomaly clustering: list of (ts, feed, score)
        self.recent_highs: List[tuple] = []
        self.last_cluster_emit = 0.0

    def ingest(self, feed: str, detections: list[dict]) -> list[dict]:
        """
        Process a batch of detections.
        Returns list of track events to emit.
        """
        now = time.time()
        ai = get_runtime_ai_settings()
        if not ai.get("correlator_enabled", True):
            return []

        min_score = float(ai.get("correlator_min_score", 0.7))
        cooldown = int(ai.get("correlator_cooldown_sec", 60))
        events_out = []

        # Group detections by label
        by_label: Dict[str, list] = defaultdict(list)
        for d in detections:
            label = d.get("label") or d.get("class") or d.get("class_name") or "object"
            by_label[str(label)].append(d)

        for label, dets in by_label.items():
            key = (feed, label)
            peak = max(float(d.get("conf", d.get("score", 0.5))) for d in dets)

            if key not in self.tracks:
                self.tracks[key] = TrackState(feed=feed, label=label)
            t = self.tracks[key]
            t.last_ts = now
            t.count += len(dets)
            t.peak_score = max(t.peak_score, peak)

            events_out.append({
                "track_id": t.track_id,
                "feed": feed,
                "label": label,
                "detections_count": t.count,
                "first_ts": t.start_ts,
                "last_ts": t.last_ts,
                "peak_score": round(t.peak_score, 3),
            })

            if peak >= min_score:
                self.recent_highs.append((now, feed, peak))

        # Expire stale tracks
        to_close = [k for k, t in self.tracks.items() if now - t.last_ts > TRACK_WINDOW_SEC]
        for k in to_close:
            track = self.tracks.pop(k)
            _store_track_entity(track)

        # Prune old anomaly history
        cutoff = now - ANOMALY_WINDOW_SEC
        self.recent_highs = [(ts, f, s) for ts, f, s in self.recent_highs if ts >= cutoff]

        # Check for cross-feed anomaly cluster
        feeds_in_window = {f for _, f, _ in self.recent_highs}
        if len(feeds_in_window) >= ANOMALY_MIN_FEEDS and now - self.last_cluster_emit >= cooldown:
            scores = [s for _, _, s in self.recent_highs]
            avg = sum(scores) / len(scores)
            events_out.append({
                "_cluster": True,
                "feeds": list(feeds_in_window),
                "cluster_size": len(self.recent_highs),
                "avg_score": round(avg, 3),
                "window_start": min(ts for ts, _, _ in self.recent_highs),
                "window_end": now,
            })
            self.last_cluster_emit = now
            self.recent_highs.clear()

        return events_out


_correlator = Correlator()


async def correlator_loop(stop_event: asyncio.Event):
    await publish("correlator.start", "INFO", "correlator", {})

    import nats  # type: ignore
    nc = await nats.connect(settings.nats_url)
    queue: asyncio.Queue = asyncio.Queue()

    async def _cb(msg):
        try:
            data = json.loads(msg.data.decode())
            await queue.put(data)
        except Exception:
            pass

    await nc.subscribe("video.detections", cb=_cb)

    try:
        while not stop_event.is_set():
            try:
                data = await asyncio.wait_for(queue.get(), timeout=1.0)
                payload = data.get("payload", {})
                feed = payload.get("feed", data.get("source", "unknown"))
                dets = payload.get("detections", [])
                if not dets:
                    continue

                track_events = _correlator.ingest(feed, dets)

                for evt in track_events:
                    if evt.get("_cluster"):
                        await publish("anomaly.cluster", "WARN", "correlator", evt)
                    else:
                        await publish("track.updated", "INFO", "correlator", evt)

            except asyncio.TimeoutError:
                pass
    finally:
        await nc.close()
