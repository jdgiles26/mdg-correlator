/**
 * useObjectDetection hook — MediaPipe object detection for video streams.
 * 
 * Captures frames from a video element, sends them to the API for detection,
 * and returns detected objects with bounding boxes.
 * 
 * Note: Detection only works for same-origin or CORS-enabled video sources.
 * YouTube/Vimeo embeds cannot be captured due to browser security restrictions.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { detectObjects, type Detection } from "../api";

interface DetectionState {
  isDetecting: boolean;
  detections: Detection[];
  error: string | null;
  fps: number;
}

interface UseObjectDetectionReturn extends DetectionState {
  startDetection: (videoElement: HTMLVideoElement) => void;
  stopDetection: () => void;
  toggleDetection: (videoElement: HTMLVideoElement | null) => void;
}

interface DetectionControls {
  enabled?: boolean;
  fps?: number;
  threshold?: number;
}

export function useObjectDetection(
  onDetection?: (detections: Detection[]) => void,
  controls?: DetectionControls
): UseObjectDetectionReturn {
  const [state, setState] = useState<DetectionState>({
    isDetecting: false,
    detections: [],
    error: null,
    fps: 0,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastCaptureRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFpsUpdateRef = useRef<number>(Date.now());
  const consecutiveErrorsRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);

  // Create canvas for frame capture
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    canvasRef.current = canvas;

    return () => {
      stopDetectionInternal();
      canvasRef.current = null;
    };
  }, []);

  const captureAndDetect = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || inFlightRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Check if video is ready
    if (video.readyState < 2 || video.paused || video.ended) return;

    // Draw frame to canvas
    const videoWidth = video.videoWidth || video.offsetWidth;
    const videoHeight = video.videoHeight || video.offsetHeight;

    // Maintain aspect ratio and resize for performance
    const scale = Math.min(640 / videoWidth, 480 / videoHeight);
    const drawWidth = Math.floor(videoWidth * scale);
    const drawHeight = Math.floor(videoHeight * scale);

    canvas.width = drawWidth;
    canvas.height = drawHeight;
    
    try {
      inFlightRef.current = true;
      ctx.drawImage(video, 0, 0, drawWidth, drawHeight);

      // Convert to base64 - this will throw if canvas is tainted
      const imageBase64 = canvas.toDataURL("image/jpeg", 0.85);
      
      // Reset error counter on success
      consecutiveErrorsRef.current = 0;

      const result = await detectObjects(imageBase64, controls?.threshold ?? 0.45);
      
      setState((prev) => ({
        ...prev,
        detections: result.detections,
        error: null,
      }));

      if (onDetection) {
        onDetection(result.detections);
      }

      // Update FPS counter
      frameCountRef.current++;
      const now = Date.now();
      if (now - lastFpsUpdateRef.current >= 1000) {
        setState((prev) => ({ ...prev, fps: frameCountRef.current }));
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = now;
      }
    } catch (err: any) {
      consecutiveErrorsRef.current++;
      
      // Check if it's a CORS/tainted canvas error
      const errorMessage = err.message || "";
      const isCorsError = errorMessage.includes("Tainted") || 
                          errorMessage.includes("cross-origin") ||
                          errorMessage.includes("CORS");
      
      if (isCorsError) {
        setState((prev) => ({
          ...prev,
          error: "Cannot detect on cross-origin video (YouTube/Vimeo). Use HLS/direct video instead.",
        }));
        // Stop detection after a few CORS errors
        if (consecutiveErrorsRef.current >= 3) {
          stopDetectionInternal();
        }
      } else {
        setState((prev) => ({
          ...prev,
          error: err.message || "Detection failed",
        }));
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [controls?.threshold, onDetection]);

  const stopDetectionInternal = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    videoRef.current = null;
    setState((prev) => ({
      ...prev,
      isDetecting: false,
      detections: [],
      fps: 0,
    }));
  }, []);

  const detectionLoop = useCallback(() => {
    if (!videoRef.current) return;

    if (controls?.enabled === false) {
      stopDetectionInternal();
      return;
    }

    const now = Date.now();
    const captureInterval = 1000 / Math.max(0.2, controls?.fps ?? 1);
    if (now - lastCaptureRef.current >= captureInterval) {
      captureAndDetect();
      lastCaptureRef.current = now;
    }

    animationRef.current = requestAnimationFrame(detectionLoop);
  }, [captureAndDetect, controls?.enabled, controls?.fps, stopDetectionInternal]);

  const startDetectionInternal = useCallback((videoElement: HTMLVideoElement) => {
    if (!canvasRef.current) return;

    const src = videoElement.src || "";
    const currentSrc = videoElement.currentSrc || "";
    const isYouTube = src.includes("youtube") || currentSrc.includes("youtube");
    const isVimeo = src.includes("vimeo") || currentSrc.includes("vimeo");

    if (isYouTube || isVimeo) {
      setState((prev) => ({
        ...prev,
        error: "Object detection is not available for YouTube/Vimeo videos due to browser security restrictions. Use HLS streams or direct video URLs instead.",
      }));
      return;
    }
    if (controls?.enabled === false) {
      setState((prev) => ({
        ...prev,
        error: "Manual detection is disabled in AI Controls.",
      }));
      return;
    }

    videoRef.current = videoElement;
    lastCaptureRef.current = Date.now();
    lastFpsUpdateRef.current = Date.now();
    frameCountRef.current = 0;
    consecutiveErrorsRef.current = 0;

    setState((prev) => ({ ...prev, isDetecting: true, error: null }));
    animationRef.current = requestAnimationFrame(detectionLoop);
  }, [controls?.enabled, detectionLoop]);

  const startDetection = useCallback((videoElement: HTMLVideoElement) => {
    if (state.isDetecting) {
      stopDetectionInternal();
    }
    startDetectionInternal(videoElement);
  }, [state.isDetecting, startDetectionInternal, stopDetectionInternal]);

  const stopDetection = useCallback(() => {
    stopDetectionInternal();
  }, [stopDetectionInternal]);

  const toggleDetection = useCallback((videoElement: HTMLVideoElement | null) => {
    if (state.isDetecting) {
      stopDetectionInternal();
    } else if (videoElement) {
      startDetectionInternal(videoElement);
    }
  }, [state.isDetecting, startDetectionInternal, stopDetectionInternal]);

  return {
    ...state,
    startDetection,
    stopDetection,
    toggleDetection,
  };
}
