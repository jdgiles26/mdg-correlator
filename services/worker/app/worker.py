"""
Worker supervisor — orchestrates all background tasks.

Tasks started:
  osint_loop       — poll OSINT feeds, publish to NATS
  predictor_loop   — anomaly prediction on event timeseries
  correlator_loop  — group detections into tracks + anomaly clusters
  ner_loop         — NER entity extraction → graph
  embed_loop       — text chunking + embedding → Qdrant  (if ENABLE_EMBEDDINGS=true)
  sync_feeds       — sync RTSP feeds to MediaMTX + run inference (every 5s)
"""
import asyncio
import time
from typing import Dict

from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Feed
from .nats_bus import publish
from .rtsp_restream import start_restream, stop_restream, RestreamProc
from .video_infer import run_inference, InferTask
from .osint_ingest import osint_loop
from .predictor import predictor_loop
from .correlator import correlator_loop
from .ner_worker import ner_loop
from .embed_worker import embed_loop
from .settings import settings


class Supervisor:
    def __init__(self):
        self.stop = asyncio.Event()
        self.restreams: Dict[str, RestreamProc] = {}
        self.infer_stops: Dict[str, asyncio.Event] = {}
        self.infer_tasks: Dict[str, asyncio.Task] = {}

    async def sync_feeds(self):
        db: Session = SessionLocal()
        try:
            feeds = db.query(Feed).order_by(Feed.id.asc()).all()
        finally:
            db.close()

        desired = {f.name: f for f in feeds if f.enabled}

        # Stop removed/disabled
        for name in list(self.restreams.keys()):
            if name not in desired:
                await self.stop_feed(name)

        # Start new feeds
        for name, f in desired.items():
            if name not in self.restreams:
                await self.start_feed(f.name, f.rtsp_url)

    async def start_feed(self, name: str, src_rtsp: str):
        try:
            rp = await start_restream(name, src_rtsp)
            self.restreams[name] = rp

            st = asyncio.Event()
            self.infer_stops[name] = st
            rtsp_local = f"rtsp://mediamtx:8554/{name}"
            self.infer_tasks[name] = asyncio.create_task(
                run_inference(InferTask(name=name, rtsp_url=rtsp_local, fps=1.0), st)
            )
            await publish("feeds.started", "INFO", "supervisor", {"name": name})
        except Exception as e:
            await publish("feeds.start_error", "WARN", "supervisor",
                          {"name": name, "error": str(e)[:200]})

    async def stop_feed(self, name: str):
        try:
            if name in self.infer_stops:
                self.infer_stops[name].set()
            if name in self.infer_tasks:
                try:
                    await asyncio.wait_for(self.infer_tasks[name], timeout=5)
                except Exception:
                    pass
                self.infer_tasks.pop(name, None)
            if name in self.restreams:
                await stop_restream(self.restreams[name])
                self.restreams.pop(name, None)
            await publish("feeds.stopped", "INFO", "supervisor", {"name": name})
        except Exception as e:
            await publish("feeds.stop_error", "WARN", "supervisor",
                          {"name": name, "error": str(e)[:200]})


async def main():
    sup = Supervisor()
    await publish("worker.start", "INFO", "worker", {
        "ts": int(time.time()),
        "embeddings": settings.enable_embeddings,
    })

    # Start all background tasks
    osint_task = asyncio.create_task(osint_loop(sup.stop))
    pred_task = asyncio.create_task(predictor_loop(sup.stop))
    corr_task = asyncio.create_task(correlator_loop(sup.stop))
    ner_task = asyncio.create_task(ner_loop(sup.stop))
    embed_task = asyncio.create_task(embed_loop(sup.stop))

    try:
        while not sup.stop.is_set():
            await sup.sync_feeds()
            await asyncio.sleep(5)
    except KeyboardInterrupt:
        pass
    finally:
        sup.stop.set()
        for name in list(sup.restreams.keys()):
            await sup.stop_feed(name)
        for t in [osint_task, pred_task, corr_task, ner_task, embed_task]:
            try:
                t.cancel()
            except Exception:
                pass


if __name__ == "__main__":
    asyncio.run(main())
