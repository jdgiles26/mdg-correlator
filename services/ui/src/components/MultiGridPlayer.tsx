/**
 * MultiGridPlayer — single cell in the 25-grid layout.
 *
 * Uses @vidstack/react with preset-based rendering:
 *   • "hls"     — HLS .m3u8 stream (type explicitly set to application/x-mpegurl)
 *   • "live"    — same as hls, streamType="live"
 *   • "youtube" — YouTube video/stream by ID or full URL
 *   • "vimeo"   — Vimeo video by ID or full URL
 *   • "video"   — direct MP4/WebM file
 *   • "audio"   — audio-only stream or file
 *
 * Vidstack docs: https://vidstack.io/player/docs/react/
 */
import React, { useMemo } from "react";
import { MediaPlayer, MediaProvider, Poster } from "@vidstack/react";
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from "@vidstack/react/player/layouts/default";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";

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
}

// ─── Source resolution ────────────────────────────────────────────────────────

/**
 * Build the src value Vidstack expects per preset.
 * HLS/live: must include explicit MIME type so Vidstack uses its HLS loader.
 * YouTube/Vimeo: Vidstack expects the "protocol/id" format.
 */
function buildSrc(
  raw: string,
  preset: StreamPreset
): string | { src: string; type: string } {
  switch (preset) {
    case "hls":
    case "live":
      return { src: raw, type: "application/x-mpegurl" };

    case "youtube": {
      const m = raw.match(
        /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
      );
      const id = m ? m[1] : raw;
      return `youtube/${id}`;
    }

    case "vimeo": {
      const m = raw.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      const id = m ? m[1] : raw;
      return `vimeo/${id}`;
    }

    case "video":
      return { src: raw, type: guessVideoType(raw) };

    case "audio":
      return { src: raw, type: guessAudioType(raw) };

    default:
      return raw;
  }
}

function guessVideoType(url: string): string {
  if (url.includes(".m3u8")) return "application/x-mpegurl";
  if (url.includes(".webm")) return "video/webm";
  return "video/mp4";
}

function guessAudioType(url: string): string {
  if (url.includes(".ogg")) return "audio/ogg";
  if (url.includes(".aac")) return "audio/aac";
  return "audio/mpeg";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MultiGridPlayer({
  stream,
  cellHeight = 160,
}: MultiGridPlayerProps) {
  const preset: StreamPreset = stream.preset ?? "live";
  const isLive = preset === "live" || preset === "hls";
  const isWebpage = preset === "webpage";

  const src = useMemo(
    () => (isWebpage ? stream.hlsUrl : buildSrc(stream.hlsUrl, preset)),
    [stream.hlsUrl, preset, isWebpage]
  );

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

  return (
    <div
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

      {isWebpage ? (
        /* ── Webpage iframe embed ─────────────────────────────────────── */
        <iframe
          src={stream.hlsUrl}
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
        /* ── Vidstack media player ────────────────────────────────────── */
        <MediaPlayer
          src={src as any}
          autoPlay
          muted
          playsInline
          streamType={isLive ? "live" : "on-demand"}
          style={{ width: "100%", height: "100%" }}
          viewType="video"
          logLevel="error"
        >
          <MediaProvider>
            {stream.poster && (
              <Poster src={stream.poster} alt={stream.label} />
            )}
          </MediaProvider>
          <DefaultVideoLayout icons={defaultLayoutIcons} />
        </MediaPlayer>
      )}

      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }
      `}</style>
    </div>
  );
}
