"""
MediaPipe Object Detection endpoint.

Provides real-time object detection on video frames using MediaPipe.
Clients can send frames as base64-encoded images and receive detections.
"""
import base64
import io
from typing import Any, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np
from ..events_bus import publish_event

try:
    import mediapipe as mp
    from mediapipe.tasks.python.core.base_options import BaseOptions
    from mediapipe.tasks.python.vision import ObjectDetector, ObjectDetectorOptions, RunningMode
    MEDIAPIPE_AVAILABLE = True
except ImportError as e:
    print(f"MediaPipe import error: {e}")
    MEDIAPIPE_AVAILABLE = False

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

router = APIRouter(prefix="/api/detect", tags=["detection"])

# Global model cache
_detection_model = None


def _safe_category_value(category: Any, key: str, default: Any = None) -> Any:
    """Read MediaPipe category attributes defensively across model variants."""
    if category is None:
        return default
    value = getattr(category, key, default)
    return default if value is None else value


def _normalize_category(category: Any, fallback_index: int) -> tuple[int, str, float]:
    index = _safe_category_value(category, "index", fallback_index)
    try:
        class_id = int(index)
    except (TypeError, ValueError):
        class_id = fallback_index

    class_name = (
        _safe_category_value(category, "category_name")
        or _safe_category_value(category, "display_name")
        or f"class_{class_id}"
    )

    score = _safe_category_value(category, "score", 0.0)
    try:
        norm_score = float(score)
    except (TypeError, ValueError):
        norm_score = 0.0

    return class_id, str(class_name), norm_score


def get_detection_model(model_path: Optional[str] = None):
    """Get or create the MediaPipe object detection model."""
    global _detection_model
    if _detection_model is None:
        if not MEDIAPIPE_AVAILABLE:
            raise RuntimeError("MediaPipe not available")
        
        # Use the default EfficientDet-Lite0 model if no path provided
        if model_path is None:
            # Download the model if not present
            import urllib.request
            import os
            
            model_url = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite"
            model_dir = os.path.expanduser("~/.mediapipe/models")
            os.makedirs(model_dir, exist_ok=True)
            model_path = os.path.join(model_dir, "efficientdet_lite0.tflite")
            
            if not os.path.exists(model_path):
                urllib.request.urlretrieve(model_url, model_path)
        
        base_options = BaseOptions(model_asset_path=model_path)
        options = ObjectDetectorOptions(
            base_options=base_options,
            score_threshold=0.3,
            running_mode=RunningMode.IMAGE
        )
        _detection_model = ObjectDetector.create_from_options(options)
    
    return _detection_model


class DetectionRequest(BaseModel):
    """Request body for object detection."""
    image_base64: str
    threshold: float = 0.3


class Detection(BaseModel):
    """Single detection result."""
    class_id: int
    class_name: str
    score: float
    bbox: dict  # {x, y, width, height} normalized 0-1


class DetectionResponse(BaseModel):
    """Response from object detection."""
    detections: List[Detection]
    model: str = "mediapipe_efficientdet_lite0"


class UIDetectionEvent(BaseModel):
    feed: str
    source_url: str | None = None
    preset: str | None = None
    cell_index: int | None = None
    detections: List[Detection]


def decode_base64_image(base64_string: str) -> np.ndarray:
    """Decode base64 string to numpy array (RGB)."""
    # Remove data URL prefix if present
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]
    
    image_bytes = base64.b64decode(base64_string)
    
    if PIL_AVAILABLE:
        image = Image.open(io.BytesIO(image_bytes))
        return np.array(image)
    else:
        import cv2
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


@router.post("/frame", response_model=DetectionResponse)
async def detect_objects(request: DetectionRequest):
    """
    Detect objects in a single frame.
    
    Expects a base64-encoded image and returns detected objects with bounding boxes.
    """
    if not MEDIAPIPE_AVAILABLE:
        raise HTTPException(status_code=503, detail="MediaPipe not available")
    
    try:
        # Decode image
        image_array = decode_base64_image(request.image_base64)
        
        # Convert to MediaPipe Image
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_array)
        
        # Get model and run detection
        model = get_detection_model()
        detection_result = model.detect(mp_image)
        
        # Convert results
        detections = []
        for fallback_index, detection in enumerate(detection_result.detections):
            if not detection.categories:
                continue
            class_id, class_name, score = _normalize_category(detection.categories[0], fallback_index)
            if score >= request.threshold:
                bbox = detection.bounding_box
                detections.append(Detection(
                    class_id=class_id,
                    class_name=class_name,
                    score=score,
                    bbox={
                        "x": bbox.origin_x / image_array.shape[1],
                        "y": bbox.origin_y / image_array.shape[0],
                        "width": bbox.width / image_array.shape[1],
                        "height": bbox.height / image_array.shape[0]
                    }
                ))
        
        return DetectionResponse(detections=detections)
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection error: {str(e)}")


@router.get("/health")
async def detection_health():
    """Check if detection service is available."""
    return {
        "available": MEDIAPIPE_AVAILABLE,
        "pil_available": PIL_AVAILABLE,
        "model_loaded": _detection_model is not None
    }


@router.post("/event")
async def publish_ui_detection_event(body: UIDetectionEvent):
    if not body.detections:
        return {"ok": True, "published": False, "reason": "No detections supplied."}

    peak_score = max(float(det.score) for det in body.detections)
    score = min(1.0, peak_score * 0.75 + min(0.25, len(body.detections) * 0.05))
    payload = {
        "feed": body.feed,
        "source_url": body.source_url,
        "preset": body.preset,
        "cell_index": body.cell_index,
        "origin": "ui-grid",
        "count": len(body.detections),
        "detections": [
            {
                "class_id": det.class_id,
                "class_name": det.class_name,
                "class": det.class_name,
                "score": float(det.score),
                "conf": float(det.score),
                "bbox": det.bbox,
            }
            for det in body.detections
        ],
    }
    await publish_event(
        topic="video.detections",
        severity="INFO",
        source=f"ui:{body.feed}",
        payload=payload,
        score=score,
    )
    return {
        "ok": True,
        "published": True,
        "topic": "video.detections",
        "score": round(score, 4),
        "count": len(body.detections),
        "feed": body.feed,
    }
