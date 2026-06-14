/**
 * GridObjectDetection — Grid-level MediaPipe object detection.
 * 
 * Captures the entire grid container as a single image and runs object detection
 * on all visible videos simultaneously. This is more efficient than per-cell
 * detection and works around CORS issues since we're capturing the rendered DOM.
 */
import React, { useState, useCallback, useRef, useEffect } from "react";
import { detectObjects, type Detection } from "../api";
import { ScanLine, X, Camera } from "lucide-react";

interface GridDetectionState {
  isDetecting: boolean;
  detections: Map<number, Detection[]>; // cell index -> detections
  error: string | null;
  fps: number;
}

interface DetectionControls {
  enabled?: boolean;
  fps?: number;
  threshold?: number;
}

export function useGridObjectDetection(
  gridContainerRef: React.RefObject<HTMLDivElement>,
  cellCount: number,
  onDetection?: (cellIndex: number, detections: Detection[]) => void,
  controls?: DetectionControls
) {
  const [state, setState] = useState<GridDetectionState>({
    isDetecting: false,
    detections: new Map(),
    error: null,
    fps: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastCaptureRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFpsUpdateRef = useRef<number>(Date.now());
  const inFlightRef = useRef<boolean>(false);

  const stopDetection = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      isDetecting: false,
      detections: new Map(),
      fps: 0,
    }));
  }, []);

  // Create canvas for frame capture
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;

    return () => {
      stopDetection();
      canvasRef.current = null;
    };
  }, []);

  const captureAndDetect = useCallback(async () => {
    if (!gridContainerRef.current || !canvasRef.current || inFlightRef.current) return;

    const container = gridContainerRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      inFlightRef.current = true;
      // Use html2canvas-like approach - draw the container to canvas
      // First, temporarily hide the detection UI elements
      const detectionButtons = container.querySelectorAll('[data-detection-ui="true"]');
      detectionButtons.forEach((el) => {
        (el as HTMLElement).style.visibility = 'hidden';
      });

      // Get container dimensions
      const rect = container.getBoundingClientRect();
      const scale = Math.min(1280 / rect.width, 720 / rect.height);
      const canvasWidth = Math.floor(rect.width * scale);
      const canvasHeight = Math.floor(rect.height * scale);

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      // Use dom-to-image or similar approach - for now use native canvas
      // Draw white background
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Find all video elements in the grid
      const videos = container.querySelectorAll('video');
      const newDetections = new Map<number, Detection[]>();

      // Process each video cell
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        if (video.readyState < 2 || video.paused || video.ended) continue;

        // Get video's position relative to container
        const videoRect = video.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        
        const relX = (videoRect.left - containerRect.left) * scale;
        const relY = (videoRect.top - containerRect.top) * scale;
        const relWidth = videoRect.width * scale;
        const relHeight = videoRect.height * scale;

        // Draw video frame
        try {
          ctx.drawImage(video, relX, relY, relWidth, relHeight);
        } catch (e) {
          // Cross-origin video, skip
          continue;
        }
      }

      // Restore UI elements
      detectionButtons.forEach((el) => {
        (el as HTMLElement).style.visibility = 'visible';
      });

      // Convert to base64 and detect
      const imageBase64 = canvas.toDataURL("image/jpeg", 0.85);
      const result = await detectObjects(imageBase64, controls?.threshold ?? 0.45);

      // Map detections to cells based on position
      result.detections.forEach((det) => {
        const detX = det.bbox.x * canvasWidth;
        const detY = det.bbox.y * canvasHeight;

        // Find which cell this detection belongs to
        videos.forEach((video, cellIndex) => {
          const videoRect = video.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const relX = (videoRect.left - containerRect.left) * scale;
          const relY = (videoRect.top - containerRect.top) * scale;
          const relWidth = videoRect.width * scale;
          const relHeight = videoRect.height * scale;

          if (
            detX >= relX &&
            detX <= relX + relWidth &&
            detY >= relY &&
            detY <= relY + relHeight
          ) {
            // Adjust bbox to be relative to the cell
            const cellDet = {
              ...det,
              bbox: {
                x: (detX - relX) / relWidth,
                y: (detY - relY) / relHeight,
                width: det.bbox.width * (canvasWidth / relWidth),
                height: det.bbox.height * (canvasHeight / relHeight),
              },
            };

            if (!newDetections.has(cellIndex)) {
              newDetections.set(cellIndex, []);
            }
            newDetections.get(cellIndex)!.push(cellDet);

          }
        });
      });

      if (onDetection) {
        newDetections.forEach((cellDetections, cellIndex) => {
          onDetection(cellIndex, cellDetections);
        });
      }

      setState((prev) => ({
        ...prev,
        detections: newDetections,
        error: null,
      }));

      // Update FPS counter
      frameCountRef.current++;
      const now = Date.now();
      if (now - lastFpsUpdateRef.current >= 1000) {
        setState((prev) => ({ ...prev, fps: frameCountRef.current }));
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = now;
      }
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        error: err.message || "Detection failed",
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, [controls?.threshold, gridContainerRef, onDetection]);

  const detectionLoop = useCallback(() => {
    if (controls?.enabled === false) {
      stopDetection();
      return;
    }

    const now = Date.now();
    const captureInterval = 1000 / Math.max(0.2, controls?.fps ?? 1);
    if (now - lastCaptureRef.current >= captureInterval) {
      captureAndDetect();
      lastCaptureRef.current = now;
    }

    animationRef.current = requestAnimationFrame(detectionLoop);
  }, [captureAndDetect, controls?.enabled, controls?.fps, stopDetection]);

  const startDetection = useCallback(() => {
    if (!gridContainerRef.current) return;
    if (controls?.enabled === false) {
      setState((prev) => ({
        ...prev,
        error: "Manual grid detection is disabled in AI Controls.",
      }));
      return;
    }

    lastCaptureRef.current = Date.now();
    lastFpsUpdateRef.current = Date.now();
    frameCountRef.current = 0;

    setState((prev) => ({ ...prev, isDetecting: true, error: null }));
    animationRef.current = requestAnimationFrame(detectionLoop);
  }, [controls?.enabled, gridContainerRef, detectionLoop]);

  const toggleDetection = useCallback(() => {
    if (state.isDetecting) {
      stopDetection();
    } else {
      startDetection();
    }
  }, [state.isDetecting, startDetection, stopDetection]);

  return {
    ...state,
    startDetection,
    stopDetection,
    toggleDetection,
  };
}

// Grid-level detection control button component
export function GridDetectionControl({
  isDetecting,
  fps,
  error,
  onToggle,
}: {
  isDetecting: boolean;
  fps: number;
  error: string | null;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "rgba(8,12,30,.92)",
        border: "1px solid #1f2937",
        borderRadius: 10,
      }}
    >
      <Camera size={16} style={{ color: isDetecting ? "#22c55e" : "#94a3b8" }} />
      
      <span style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>
        Grid Detection
      </span>

      {isDetecting && fps > 0 && (
        <span
          style={{
            fontSize: 11,
            color: "#22c55e",
            background: "rgba(34,197,94,0.15)",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {fps} FPS
        </span>
      )}

      {error && (
        <span
          style={{
            fontSize: 11,
            color: "#ef4444",
            maxWidth: 300,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={error}
        >
          {error}
        </span>
      )}

      <button
        onClick={onToggle}
        data-detection-ui="true"
        style={{
          background: isDetecting ? "rgba(239,68,68,0.9)" : "rgba(34,197,94,0.9)",
          border: "none",
          borderRadius: 6,
          padding: "6px 12px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          transition: "all 0.2s",
        }}
      >
        {isDetecting ? (
          <>
            <X size={14} /> Stop
          </>
        ) : (
          <>
            <ScanLine size={14} /> Start Detection
          </>
        )}
      </button>
    </div>
  );
}
