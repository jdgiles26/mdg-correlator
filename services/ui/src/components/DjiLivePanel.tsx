import React, { useMemo, useState } from "react";
import { KeyRound, Radio, Video } from "lucide-react";
import { HLS_BASE } from "../api";
import { HlsPlayer } from "./HlsPlayer";

const DEFAULT_RTMP_PORT = "1935";
const DEFAULT_HLS_PORT = "8888";
const DEFAULT_APP_PATH = "dji";

type RtmpBase = { host: string; port: string; appPath: string };
type HttpBase = { host: string; port: string };

function browserHost(): string {
  if (typeof window !== "undefined" && window.location.hostname) {
    return window.location.hostname;
  }
  return "localhost";
}

function parseRtmpBase(raw?: string): RtmpBase | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const appPath = u.pathname.replace(/^\/+|\/+$/g, "");
    return {
      host: u.hostname || "",
      port: u.port || DEFAULT_RTMP_PORT,
      appPath: appPath || DEFAULT_APP_PATH,
    };
  } catch {
    return null;
  }
}

function parseHttpBase(raw?: string): HttpBase | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      host: u.hostname || "",
      port: u.port || DEFAULT_HLS_PORT,
    };
  } catch {
    return null;
  }
}

function normalizePath(path: string): string {
  return path
    .split("/")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => encodeURIComponent(v))
    .join("/");
}

function normalizeKey(key: string): string {
  return encodeURIComponent(key.trim());
}

export function DjiLivePanel() {
  const rtmpBase = useMemo(
    () => parseRtmpBase(import.meta.env.VITE_RTMP_BASE as string | undefined),
    []
  );
  const hlsBase = useMemo(() => parseHttpBase(HLS_BASE), []);

  const [host, setHost] = useState(
    rtmpBase?.host || hlsBase?.host || browserHost()
  );
  const [rtmpPort, setRtmpPort] = useState(rtmpBase?.port || DEFAULT_RTMP_PORT);
  const [hlsPort, setHlsPort] = useState(hlsBase?.port || DEFAULT_HLS_PORT);
  const [appPath, setAppPath] = useState(rtmpBase?.appPath || DEFAULT_APP_PATH);
  const [streamKey, setStreamKey] = useState("");

  const safeHost = host.trim() || browserHost();
  const normalizedAppPath = normalizePath(appPath) || DEFAULT_APP_PATH;
  const normalizedKey = normalizeKey(streamKey);

  const serverUrl = `rtmp://${safeHost}:${rtmpPort}/${normalizedAppPath}`;
  const publishUrl = normalizedKey ? `${serverUrl}/${normalizedKey}` : "";
  const hlsUrl = normalizedKey
    ? `http://${safeHost}:${hlsPort}/${normalizedAppPath}/${normalizedKey}/index.m3u8`
    : "";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 12,
      }}
    >
      <div style={card()}>
        <div style={h2()}>
          <Radio size={16} />
          DJI RTMP Publish Settings
        </div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 8 }}>
          Configure DJI to publish RTMP, then watch the live feed from the generated
          HLS URL in the built-in Vidstack player.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
          <label style={field()}>
            Host / IP
            <input value={host} onChange={(e) => setHost(e.target.value)} style={input()} />
          </label>
          <label style={field()}>
            RTMP Port
            <input value={rtmpPort} onChange={(e) => setRtmpPort(e.target.value)} style={input()} />
          </label>
          <label style={field()}>
            HLS Port
            <input value={hlsPort} onChange={(e) => setHlsPort(e.target.value)} style={input()} />
          </label>
          <label style={field()}>
            App Path
            <input value={appPath} onChange={(e) => setAppPath(e.target.value)} style={input()} />
          </label>
        </div>

        <label style={{ ...field(), marginTop: 8 }}>
          Stream Key
          <input
            value={streamKey}
            onChange={(e) => setStreamKey(e.target.value)}
            placeholder="enter-your-stream-key"
            style={input()}
          />
        </label>

        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <OutputRow label="DJI Server URL" value={serverUrl} />
          <OutputRow label="DJI Stream Key" value={streamKey || "enter a stream key"} />
          <OutputRow label="Full RTMP Publish URL" value={publishUrl || "enter a stream key"} />
          <OutputRow label="HLS Playback URL" value={hlsUrl || "enter a stream key"} />
        </div>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, opacity: 0.95 }}>
            DJI app setup (Custom RTMP):
          </div>
          <div>1. Server URL: use the generated DJI Server URL.</div>
          <div>2. Stream Key: use the generated DJI Stream Key.</div>
          <div>3. Start live streaming from the drone.</div>
        </div>
      </div>

      <div style={card()}>
        <div style={h2()}>
          <Video size={16} />
          Live Player
        </div>
        {hlsUrl ? (
          <>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6, marginBottom: 8 }}>
              Waiting for RTMP publisher. Playback starts when DJI stream is live.
            </div>
            <HlsPlayer hlsUrl={hlsUrl} />
          </>
        ) : (
          <div style={{ marginTop: 8, opacity: 0.8, fontSize: 13 }}>
            Enter a stream key to generate playback URL and start preview.
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7, wordBreak: "break-all" }}>
          <KeyRound size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
          {hlsUrl || "HLS URL will appear here"}
        </div>
      </div>
    </div>
  );
}

function OutputRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 11, opacity: 0.7, textTransform: "uppercase" }}>{label}</div>
      <div style={output()}>{value}</div>
    </div>
  );
}

function card() {
  return {
    background: "rgba(8,12,30,.85)",
    border: "1px solid #1f2937",
    borderRadius: 16,
    padding: 16,
  } as React.CSSProperties;
}

function h2() {
  return {
    display: "flex",
    gap: 8,
    alignItems: "center",
    fontWeight: 800,
    fontSize: 14,
  } as React.CSSProperties;
}

function field() {
  return {
    display: "grid",
    gap: 6,
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: 700,
  } as React.CSSProperties;
}

function input() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #1f2937",
    background: "#050814",
    color: "#e5e7eb",
    outline: "none",
  } as React.CSSProperties;
}

function output() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #1f2937",
    background: "#050814",
    color: "#e5e7eb",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    wordBreak: "break-all",
  } as React.CSSProperties;
}
