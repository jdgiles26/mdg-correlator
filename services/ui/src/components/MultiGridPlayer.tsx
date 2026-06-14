/**
 * MultiGridPlayer — single cell in the 25-grid layout.
 *
 * Uses native media elements with hls.js for reliable playback in the grid:
 *   • "hls"     — HLS .m3u8 stream (type explicitly set to application/x-mpegurl)
 *   • "live"    — same as hls, streamType="live"
 *   • "youtube" — YouTube video/stream by ID or full URL
 *   • "vimeo"   — Vimeo video by ID or full URL
 *   • "video"   — direct MP4/WebM file
 *   • "audio"   — audio-only stream or file
 *
 */
import React, { useMemo, useRef } from "react";
import { DetectionOverlay } from "./DetectionOverlay";
import type { Detection } from "../api";
import { StreamMedia } from "./StreamMedia";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StreamPreset =
  | "hls"
  | "live"
  | "youtube"
  | "vimeo"
  | "video"
  | "audio"
  | "webpage";

export interface GridStream {
  id: number;
  label: string;
  /** Full URL, or YouTube/Vimeo ID/URL depending on preset */
  hlsUrl: string;
  location?: string;
  /** Vidstack preset – defaults to "live" */
  preset?: StreamPreset;
  /** Optional poster image */
  poster?: string;
}

interface MultiGridPlayerProps {
  stream: GridStream;
  /** Cell height in px – defaults to 160 */
  cellHeight?: number;
  /** Detections from grid-level detection */
  detections?: Detection[];
}

// ─── Source resolution ────────────────────────────────────────────────────────

function buildSrc(raw: string, preset: StreamPreset): string {
  switch (preset) {
    case "hls":
    case "live":
      return raw;

    case "youtube": {
      const m = raw.match(
        /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
      );
      const id = m ? m[1] : raw;
      return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;
    }

    case "vimeo": {
      const m = raw.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      const id = m ? m[1] : raw;
      return `https://player.vimeo.com/video/${id}?autoplay=1&muted=1`;
    }

    case "video":
      return raw;

    case "audio":
      return raw;

    default:
      return raw;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MultiGridPlayer({
  stream,
  cellHeight = 160,
  detections,
}: MultiGridPlayerProps) {
  const preset: StreamPreset = stream.preset ?? "live";
  const isLive = preset === "live" || preset === "hls";
  const isWebpage = preset === "webpage";
  const isEmbed = preset === "youtube" || preset === "vimeo";
  const isVideo = !isWebpage && preset !== "audio";

  const containerRef = useRef<HTMLDivElement>(null);

  const src = useMemo(() => buildSrc(stream.hlsUrl, preset), [stream.hlsUrl, preset]);

  /** Shared label overlay (top bar with name + location) */
  const labelOverlay = (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        background:
          "linear-gradient(to bottom, rgba(0,0,0,.78) 0%, transparent 100%)",
        padding: "4px 8px",
        display: "flex",
        alignItems: "center",
        gap: 5,
        pointerEvents: "none",
      }}
    >
      {isLive && (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#22c55e",
            flexShrink: 0,
            boxShadow: "0 0 5px #22c55e",
            animation: "livePulse 2s infinite",
          }}
        />
      )}
      {isWebpage && (
        <span style={{ fontSize: 9, opacity: 0.7, flexShrink: 0 }}>🌐</span>
      )}
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#e5e7eb",
          textShadow: "0 1px 2px #000",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {stream.label}
      </span>
      {stream.location && (
        <span style={{ fontSize: 9, color: "#94a3b8", flexShrink: 0 }}>
          {stream.location}
        </span>
      )}
    </div>
  );

  // Detection stats overlay
  const detectionStats = detections && detections.length > 0 && (
    <div
      style={{
        position: "absolute",
        bottom: 8,
        left: 8,
        zIndex: 20,
        background: "rgba(0,0,0,0.7)",
        padding: "4px 8px",
        borderRadius: 6,
        fontSize: 10,
        color: "#e5e7eb",
      }}
    >
      {detections.length} object{detections.length !== 1 ? "s" : ""}
    </div>
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        background: "#000",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #1f2937",
        height: cellHeight,
      }}
    >
      {labelOverlay}

      {isWebpage || isEmbed ? (
        <iframe
          src={src}
          title={stream.label}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            display: "block",
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          allow="autoplay; fullscreen"
          loading="lazy"
        />
      ) : (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <StreamMedia
            kind={preset === "audio" ? "audio" : isLive ? "hls" : "video"}
            src={src}
            title={stream.label}
            autoPlay
            muted
            controls={false}
            poster={stream.poster}
          />

          {/* Detection overlay with bounding boxes */}
          {detections && detections.length > 0 && containerRef.current && (
            <DetectionOverlay
              detections={detections}
              width={containerRef.current.offsetWidth}
              height={containerRef.current.offsetHeight}
            />
          )}
        </div>
      )}

      {detectionStats}

      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }
      `}</style>
    </div>
  );
}
