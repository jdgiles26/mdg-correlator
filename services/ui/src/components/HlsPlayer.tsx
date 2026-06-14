/**
 * HlsPlayer — single-feed preview using native video + hls.js.
 * Used in the Dashboard and Feeds tabs for the selected feed's preview.
 */
import React from "react";
import { StreamMedia } from "./StreamMedia";

export function HlsPlayer({ hlsUrl }: { hlsUrl: string }) {
  return (
    <div
      style={{
        border: "1px solid #1f2937",
        borderRadius: 12,
        overflow: "hidden",
        background: "#000",
        minHeight: 320,
      }}
    >
      <StreamMedia
        kind="hls"
        src={hlsUrl}
        title="Live stream preview"
        autoPlay
        muted
        controls
        showStatus
        style={{ height: 320 }}
      />
    </div>
  );
}
