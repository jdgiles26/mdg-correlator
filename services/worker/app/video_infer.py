import asyncio
import os
import time
from dataclasses import dataclass
from typing import Optional

os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
os.environ.setdefault("OPENCV_FFMPEG_DEBUG", "0")
os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "0")
os.environ.setdefault("OPENCV_FFMPEG_SKIP_LOG_CALLBACK", "1")

import cv2

from ultralytics import YOLO
from .settings import settings
from .nats_bus import publish
from .runtime_settings import get_runtime_ai_settings

@dataclass
class InferTask:
    name: str
    rtsp_url: str

_model: Optional[YOLO] = None


def _quiet_opencv() -> None:
    try:
        cv2.setLogLevel(0)
    except Exception:
        pass


def get_model() -> YOLO:
    global _model
    if _model is None:
        # Downloads weights on first run.
        _model = YOLO("yolov8n.pt")
    return _model

async def run_inference(task: InferTask, stop_event: asyncio.Event):
    _quiet_opencv()
    cap: Optional[cv2.VideoCapture] = None
    last = 0.0
    last_heartbeat_bucket: int | None = None
    last_error_publish = 0.0
    ai = get_runtime_ai_settings(force=True)
    last_config_refresh = 0.0
    start_published = False
    opened_once = False

    while not stop_event.is_set():
        now = time.time()

        if now - last_config_refresh >= 2.0:
            ai = get_runtime_ai_settings(force=True)
            last_config_refresh = now

        if not ai.get("background_inference_enabled", True):
            if cap is not None:
                cap.release()
                cap = None
            await asyncio.sleep(1.0)
            continue

        if cap is None:
            cap = cv2.VideoCapture(task.rtsp_url)
            if not cap.isOpened():
                cap.release()
                cap = None
                publish_topic = "video.infer.error" if opened_once else "feeds.connection_issue"
                interval = 30.0 if opened_once else 90.0
                if now - last_error_publish >= interval:
                    last_error_publish = now
                    await publish(
                        publish_topic,
                        "WARN",
                        "worker",
                        {
                            "name": task.name,
                            "error": "Cannot open background inference stream",
                            "rtsp_url": task.rtsp_url,
                            "hint": (
                                "Verify the feed is a direct media stream and that MediaMTX is publishing it."
                                if opened_once
                                else "The restream path is not readable yet. Verify the upstream stream is valid and that MediaMTX is publishing it."
                            ),
                        },
                    )
                await asyncio.sleep(2.0 if opened_once else 8.0)
                continue
            opened_once = True
            if not start_published:
                await publish(
                    "video.infer.start",
                    "INFO",
                    "worker",
                    {"name": task.name, "rtsp": task.rtsp_url},
                )
                start_published = True

        interval = 1.0 / max(0.2, float(ai.get("background_inference_fps", 0.5)))
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
        conf_threshold = float(ai.get("background_detection_confidence", 0.45))
        model = get_model()
        results = model.predict(source=frame, verbose=False, imgsz=640, conf=conf_threshold)
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
            heartbeat_bucket = int(now // 10)
            if heartbeat_bucket != last_heartbeat_bucket:
                last_heartbeat_bucket = heartbeat_bucket
                await publish("video.heartbeat", "DEBUG", f"video:{task.name}", {"feed": task.name})

    if cap is not None:
        cap.release()
    await publish("video.infer.stop", "INFO", "worker", {"name": task.name})
