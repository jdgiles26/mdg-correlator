/**
 * DetectionOverlay — Renders bounding boxes for detected objects.
 */
import React from "react";
import type { Detection } from "../api";

interface DetectionOverlayProps {
  detections: Detection[];
  width: number;
  height: number;
}

// Color palette for different classes
const COLORS = [
  "#22c55e", // green
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

function getColorForClass(className: string): string {
  let hash = 0;
  for (let i = 0; i < className.length; i++) {
    hash = className.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export const DetectionOverlay: React.FC<DetectionOverlayProps> = ({
  detections,
  width,
  height,
}) => {
  if (!detections.length) return null;

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 15,
      }}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {detections.map((det, i) => {
        const x = det.bbox.x * width;
        const y = det.bbox.y * height;
        const w = det.bbox.width * width;
        const h = det.bbox.height * height;
        const color = getColorForClass(det.class_name);

        return (
          <g key={i}>
            {/* Bounding box */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={color}
              strokeWidth={2}
              rx={2}
            />
            {/* Label background */}
            <rect
              x={x}
              y={y - 18}
              width={det.class_name.length * 8 + 40}
              height={18}
              fill={color}
              rx={2}
            />
            {/* Label text */}
            <text
              x={x + 4}
              y={y - 4}
              fill="#000"
              fontSize={11}
              fontWeight={700}
            >
              {det.class_name} {(det.score * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
};
