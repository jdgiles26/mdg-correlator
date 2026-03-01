/**
 * HlsPlayer — single-feed preview using @vidstack/react.
 * Used in the Dashboard and Feeds tabs for the selected feed's preview.
 */
import React from "react";
import { MediaPlayer, MediaProvider, Poster } from "@vidstack/react";
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from "@vidstack/react/player/layouts/default";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";

export function HlsPlayer({ hlsUrl }: { hlsUrl: string }) {
  return (
    <div
      style={{
        border: "1px solid #1f2937",
        borderRadius: 12,
        overflow: "hidden",
        background: "#000",
      }}
    >
      <MediaPlayer
        src={hlsUrl}
        autoPlay
        muted
        playsInline
        live
        streamType="live"
        style={{ width: "100%", height: 320 }}
        viewType="video"
        logLevel="warn"
      >
        <MediaProvider />
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>
    </div>
  );
}
