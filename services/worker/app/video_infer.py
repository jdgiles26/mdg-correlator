import asyncio
import time
from dataclasses import dataclass
from typing import Optional
import cv2
import numpy as np

from ultralytics import YOLO
from .settings import settings
from .nats_bus import publish

@dataclass
class InferTask:
    name: str
    rtsp_url: str
    fps: float = 1.0

_model: Optional[YOLO] = None

def get_model() -> YOLO:
    global _model
    if _model is None:
        # Downloads weights on first run.
        _model = YOLO("yolov8n.pt")
    return _model

async def run_inference(task: InferTask, stop_event: asyncio.Event):
    model = get_model()
    cap = cv2.VideoCapture(task.rtsp_url)
    if not cap.isOpened():
        await publish("video.infer.error", "WARN", "worker", {"name": task.name, "error": "Cannot open RTSP"})
        return

    await publish("video.infer.start", "INFO", "worker", {"name": task.name, "rtsp": task.rtsp_url, "fps": task.fps})

    interval = 1.0 / max(0.2, task.fps)
    last = 0.0

    while not stop_event.is_set():
        now = time.time()
        if now - last < interval:
            await asyncio.sleep(0.05)
            continue
        last = now

        ok, frame = cap.read()
        if not ok or frame is None:
            await asyncio.sleep(0.2)
            continue

        # Downscale for speed
        h, w = frame.shape[:2]
        scale = 640 / max(h, w)
        if scale < 1:
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)))

        # Inference (sync call; acceptable for MVP)
        results = model.predict(source=frame, verbose=False, imgsz=640, conf=0.35)
        dets = []
        for r in results:
            if r.boxes is None:
                continue
            for b in r.boxes:
                cls = int(b.cls[0])
                conf = float(b.conf[0])
                xyxy = [float(x) for x in b.xyxy[0].tolist()]
                dets.append({"class_id": cls, "class": model.names.get(cls, str(cls)), "conf": conf, "xyxy": xyxy})

        if dets:
            # Light heuristic risk score: highest conf + count
            score = min(1.0, max([d["conf"] for d in dets]) * 0.7 + min(0.3, len(dets) * 0.05))
            await publish(
                topic="video.detections",
                severity="INFO",
                source=f"video:{task.name}",
                payload={"feed": task.name, "count": len(dets), "detections": dets[:30]},
                score=score,
            )
        else:
            # Emit sparse heartbeat
            if int(now) % 10 == 0:
                await publish("video.heartbeat", "DEBUG", f"video:{task.name}", {"feed": task.name})

    cap.release()
    await publish("video.infer.stop", "INFO", "worker", {"name": task.name})
