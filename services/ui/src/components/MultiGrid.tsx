/**
 * MultiGrid — configurable live video grid.
 *
 * Feeds are added by the user via the "+" button or by clicking an empty slot.
 * All feed configuration is persisted to localStorage so slots survive page
 * reloads and container rebuilds.  Removing a feed clears its slot and
 * updates localStorage immediately.
 *
 * Supported player presets (Vidstack):
 *   live · hls · youtube · vimeo · video · audio
 *
 * localStorage keys:
 *   multigrid_slots   — JSON array of SavedSlot | null, indexed by position
 *   multigrid_layout  — active grid layout label string
 * 
 * Grid-level Object Detection:
 *   Click "Start Detection" in the toolbar to run MediaPipe object detection
 *   on all visible videos simultaneously. Detection runs at 3 FPS and shows
 *   bounding boxes for detected objects in each cell.
 */
import React, { useCallback, useEffect, useState, useRef } from "react";
import { MultiGridPlayer, type GridStream, type StreamPreset } from "./MultiGridPlayer";
import { useGridObjectDetection, GridDetectionControl } from "./GridObjectDetection";
import { publishUIDetectionEvent, type AISettings, type Detection } from "../api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedSlot {
  preset: StreamPreset;
  url: string;
  label: string;
  location?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LS_SLOTS_KEY = "multigrid_slots";
const LS_LAYOUT_KEY = "multigrid_layout";
const MAX_SLOTS = 25;

const GRID_CONFIGS = [
  { label: "5×5 (25)", cols: 5, count: 25 },
  { label: "4×4 (16)", cols: 4, count: 16 },
  { label: "3×3  (9)", cols: 3, count: 9 },
  { label: "2×2  (4)", cols: 2, count: 4 },
  { label: "1×1  (1)", cols: 1, count: 1 },
];

const PRESET_OPTIONS: { value: StreamPreset; label: string; hint: string; example: string }[] = [
  {
    value: "live",
    label: "Live HLS",
    hint: "Live HLS .m3u8 URL",
    example: "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8",
  },
  {
    value: "hls",
    label: "HLS VOD",
    hint: "HLS .m3u8 URL (VOD or live)",
    example: "https://stream.mux.com/DS00Spx1CV902MCtPj5WknGlR102V5HFkDe/high.m3u8",
  },
  {
    value: "youtube",
    label: "YouTube",
    hint: "YouTube URL or video ID",
    example: "https://www.youtube.com/@NASA/live",
  },
  {
    value: "vimeo",
    label: "Vimeo",
    hint: "Vimeo URL or video ID",
    example: "https://vimeo.com/76979871",
  },
  {
    value: "webpage",
    label: "Webpage",
    hint: "Any website URL to embed (may be blocked by X-Frame-Options)",
    example: "https://example.com",
  },
  {
    value: "video",
    label: "Video file",
    hint: "Direct MP4 / WebM URL",
    example: "https://example.com/video.mp4",
  },
  {
    value: "audio",
    label: "Audio",
    hint: "Audio stream or file URL",
    example: "https://example.com/stream.mp3",
  },
];

// ─── localStorage helpers ─────────────────────────────────────────────────────

function loadSlots(): (SavedSlot | null)[] {
  try {
    const raw = localStorage.getItem(LS_SLOTS_KEY);
    if (!raw) return Array(MAX_SLOTS).fill(null);
    const parsed = JSON.parse(raw);
    // Ensure always MAX_SLOTS length
    const arr: (SavedSlot | null)[] = Array(MAX_SLOTS).fill(null);
    if (Array.isArray(parsed)) {
      parsed.forEach((item: SavedSlot | null, i: number) => {
        if (i < MAX_SLOTS) arr[i] = item ?? null;
      });
    }
    return arr;
  } catch {
    return Array(MAX_SLOTS).fill(null);
  }
}

function saveSlots(slots: (SavedSlot | null)[]): void {
  try {
    localStorage.setItem(LS_SLOTS_KEY, JSON.stringify(slots));
  } catch {}
}

function loadLayout(): string {
  return localStorage.getItem(LS_LAYOUT_KEY) ?? GRID_CONFIGS[0].label;
}

function saveLayout(label: string): void {
  try {
    localStorage.setItem(LS_LAYOUT_KEY, label);
  } catch {}
}

// ─── Slot configurator modal ──────────────────────────────────────────────────

function SlotConfigurator({
  slotIndex,
  initial,
  onSave,
  onClose,
}: {
  slotIndex: number;
  initial?: SavedSlot;
  onSave: (s: SavedSlot) => void;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState<StreamPreset>(initial?.preset ?? "live");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");

  const opt = PRESET_OPTIONS.find((p) => p.value === preset)!;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e: any) => e.stopPropagation()}
        style={{
          background: "#0b1024",
          border: "1px solid #1f2937",
          borderRadius: 16,
          padding: 24,
          width: 480,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>
            {initial ? `⚙ Edit Slot ${slotIndex + 1}` : `＋ Add Feed — Slot ${slotIndex + 1}`}
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Preset selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>Player type</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PRESET_OPTIONS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPreset(p.value)}
                style={chipStyle(p.value === preset)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* URL */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>{opt.hint}</label>
          <input
            value={url}
            onChange={(e: any) => setUrl(e.target.value)}
            placeholder={opt.example}
            style={inputStyle}
            autoFocus
          />
        </div>

        {/* Label */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>Display label</label>
          <input
            value={label}
            onChange={(e: any) => setLabel(e.target.value)}
            placeholder="e.g. Cam 1 — Lobby"
            style={inputStyle}
          />
        </div>

        {/* Location (optional) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>Location / source <span style={{ opacity: 0.5 }}>(optional)</span></label>
          <input
            value={location}
            onChange={(e: any) => setLocation(e.target.value)}
            placeholder="e.g. New York, NY"
            style={inputStyle}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
          <button onClick={onClose} style={chipStyle(false)}>Cancel</button>
          <button
            disabled={!url.trim()}
            onClick={() =>
              url.trim() &&
              onSave({
                preset,
                url: url.trim(),
                label: label.trim() || url.trim(),
                location: location.trim() || undefined,
              })
            }
            style={{
              ...chipStyle(true),
              opacity: url.trim() ? 1 : 0.4,
              cursor: url.trim() ? "pointer" : "not-allowed",
            }}
          >
            {initial ? "Save changes" : "Add feed"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Single cell ──────────────────────────────────────────────────────────────

function EmptySlot({
  index,
  height,
  onAdd,
}: {
  index: number;
  height: number;
  onAdd: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onAdd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height,
        background: hovered ? "rgba(56,189,248,.04)" : "#050814",
        borderRadius: 8,
        border: `1px dashed ${hovered ? "#38bdf8" : "#1f2937"}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: "pointer",
        transition: "border-color .15s, background .15s",
      }}
    >
      <span style={{ fontSize: 20, opacity: hovered ? 1 : 0.5 }}>＋</span>
      <span style={{ fontSize: 10, color: hovered ? "#38bdf8" : "#475569" }}>
        Slot {index + 1} — click to add feed
      </span>
    </div>
  );
}

function FilledSlot({
  slot,
  index,
  height,
  onEdit,
  onRemove,
  detections,
}: {
  slot: SavedSlot;
  index: number;
  height: number;
  onEdit: () => void;
  onRemove: () => void;
  detections?: Detection[];
}) {
  const [hovered, setHovered] = useState(false);

  const stream: GridStream = {
    id: index,
    label: slot.label,
    hlsUrl: slot.url,
    preset: slot.preset,
    location: slot.location,
  };

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <MultiGridPlayer stream={stream} cellHeight={height} detections={detections} />

      {hovered && (
        <div
          style={{
            position: "absolute",
            top: 26,
            right: 6,
            zIndex: 20,
            display: "flex",
            gap: 4,
          }}
        >
          <button
            onClick={(e: any) => { e.stopPropagation(); onEdit(); }}
            title="Edit feed"
            style={floatBtn}
          >
            ⚙
          </button>
          <button
            onClick={(e: any) => { e.stopPropagation(); onRemove(); }}
            title="Remove feed"
            style={{ ...floatBtn, borderColor: "#ef4444", color: "#ef4444" }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

const floatBtn: React.CSSProperties = {
  background: "rgba(8,12,30,.92)",
  border: "1px solid #374151",
  borderRadius: 5,
  color: "#e5e7eb",
  padding: "2px 7px",
  fontSize: 11,
  cursor: "pointer",
};

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid #1f2937",
  background: "#050814",
  color: "#e5e7eb",
  outline: "none",
  width: "100%",
  fontSize: 13,
  boxSizing: "border-box",
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? "#38bdf8" : "#1f2937"}`,
    background: active ? "rgba(56,189,248,.18)" : "rgba(8,12,30,.85)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 700 : 400,
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MultiGrid({ aiSettings }: { aiSettings?: AISettings | null }) {
  // ── State initialised from localStorage ──────────────────────────────────
  const [slots, setSlots] = useState<(SavedSlot | null)[]>(() => loadSlots());
  const [gridCfg, setGridCfg] = useState(
    () => GRID_CONFIGS.find((g) => g.label === loadLayout()) ?? GRID_CONFIGS[0]
  );
  const [editing, setEditing] = useState<number | null>(null);
  const [detectionStatus, setDetectionStatus] = useState<{ tone: "info" | "success" | "error"; text: string } | null>(null);
  
  // Ref for grid container (used by detection)
  const gridRef = useRef<HTMLDivElement>(null);
  const detectionPublishRef = useRef<Map<number, { signature: string; at: number }>>(new Map());
  const feedbackTimeoutRef = useRef<number | null>(null);

  const visibleSlots = slots.slice(0, gridCfg.count);
  const filledCount = visibleSlots.filter(Boolean).length;
  const totalFilled = slots.filter(Boolean).length;

  const pushFeedback = useCallback((tone: "info" | "success" | "error", text: string) => {
    setDetectionStatus({ tone, text });
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(tone === "error" ? [20, 30, 20] : 18);
    }
    if (feedbackTimeoutRef.current !== null) {
      window.clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = window.setTimeout(() => setDetectionStatus(null), 4500);
  }, []);

  const handleGridDetection = useCallback(async (cellIndex: number, cellDetections: Detection[]) => {
    const slot = visibleSlots[cellIndex];
    if (!slot || !cellDetections.length) return;

    const signature = cellDetections
      .map((det) => `${det.class_name}:${Math.round(det.score * 100)}`)
      .sort()
      .join("|");
    const current = detectionPublishRef.current.get(cellIndex);
    const cooldownMs = Math.max(6000, (aiSettings?.task_event_cooldown_sec ?? 90) * 1000);
    if (current && current.signature === signature && Date.now() - current.at < cooldownMs) {
      return;
    }
    detectionPublishRef.current.set(cellIndex, { signature, at: Date.now() });

    try {
      const result = await publishUIDetectionEvent({
        feed: slot.label,
        source_url: slot.url,
        preset: slot.preset,
        cell_index: cellIndex,
        detections: cellDetections,
      });
      if (result.published) {
        pushFeedback("success", `Published ${result.count} detection${result.count === 1 ? "" : "s"} from ${slot.label} into the alert pipeline.`);
      }
    } catch (e: any) {
      pushFeedback("error", `Detection publish failed for ${slot.label}: ${e.message || String(e)}`);
    }
  }, [aiSettings?.task_event_cooldown_sec, pushFeedback, visibleSlots]);
  
  // Grid-level object detection
  const {
    isDetecting,
    detections,
    error: detectionError,
    fps: detectionFps,
    toggleDetection,
  } = useGridObjectDetection(
    gridRef,
    gridCfg.count,
    handleGridDetection,
    aiSettings
      ? {
          enabled: aiSettings.ui_detection_enabled,
          fps: aiSettings.ui_detection_fps,
          threshold: aiSettings.ui_detection_threshold,
        }
      : undefined
  );

  // ── Persist on change ─────────────────────────────────────────────────────
  useEffect(() => { saveSlots(slots); }, [slots]);
  useEffect(() => { saveLayout(gridCfg.label); }, [gridCfg]);
  useEffect(() => () => {
    if (feedbackTimeoutRef.current !== null) {
      window.clearTimeout(feedbackTimeoutRef.current);
    }
  }, []);

  // ── Slot mutations ────────────────────────────────────────────────────────
  const saveSlot = useCallback((index: number, slot: SavedSlot) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = slot;
      return next;
    });
    setEditing(null);
  }, []);

  const removeSlot = useCallback((index: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  }, []);

  const onToggleDetection = useCallback(() => {
    pushFeedback("info", isDetecting
      ? "Grid detection stopped. No new browser detections will be published."
      : "Grid detection started. Matching detections will publish into alerts, reports, and task correlation.");
    toggleDetection();
  }, [isDetecting, pushFeedback, toggleDetection]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const cellHeight =
    gridCfg.cols <= 1 ? 480
    : gridCfg.cols <= 2 ? 340
    : gridCfg.cols <= 3 ? 240
    : 160;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          background: "rgba(8,12,30,.85)",
          border: "1px solid #1f2937",
          borderRadius: 14,
          padding: "10px 16px",
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 14, flex: 1 }}>
          📡 Live Multigrid — {gridCfg.label}
        </span>

        <span style={{ fontSize: 12, opacity: 0.6 }}>Layout:</span>
        {GRID_CONFIGS.map((g) => (
          <button
            key={g.label}
            onClick={() => setGridCfg(g)}
            style={chipStyle(g.label === gridCfg.label)}
          >
            {g.label}
          </button>
        ))}

        {/* Quick-add to first available slot */}
        <button
          onClick={() => {
            const firstEmpty = visibleSlots.findIndex((s) => s === null);
            if (firstEmpty !== -1) setEditing(firstEmpty);
          }}
          disabled={visibleSlots.every(Boolean)}
          style={{
            ...chipStyle(false),
            borderColor: "#22c55e",
            color: "#22c55e",
            opacity: visibleSlots.every(Boolean) ? 0.4 : 1,
          }}
        >
          ＋ Add feed
        </button>

        {totalFilled > 0 && (
          <button
            onClick={() => {
              if (confirm("Remove all feeds from the grid?")) {
                setSlots(Array(MAX_SLOTS).fill(null));
              }
            }}
            style={{ ...chipStyle(false), borderColor: "#ef4444", color: "#ef4444" }}
          >
            ✕ Clear all
          </button>
        )}

        {/* Grid-level detection control */}
        {filledCount > 0 && (
          <div style={{ borderLeft: "1px solid #1f2937", paddingLeft: 10 }}>
            <GridDetectionControl
              isDetecting={isDetecting}
              fps={detectionFps}
              error={detectionError}
              onToggle={onToggleDetection}
            />
          </div>
        )}

        <span
          style={{
            fontSize: 11,
            opacity: 0.5,
            borderLeft: "1px solid #1f2937",
            paddingLeft: 10,
          }}
        >
          {filledCount}/{gridCfg.count} slots filled
          {filledCount > 0 ? " · hover cell for ⚙ / ✕" : " · click any slot to add a feed"}
        </span>
      </div>

      {(detectionStatus || detectionError) && (
        <div
          style={{
            borderRadius: 12,
            padding: "10px 14px",
            border: `1px solid ${detectionStatus?.tone === "error" || detectionError ? "#ef4444" : detectionStatus?.tone === "success" ? "#22c55e" : "#38bdf8"}`,
            background: detectionStatus?.tone === "error" || detectionError ? "rgba(127,29,29,.22)" : detectionStatus?.tone === "success" ? "rgba(20,83,45,.22)" : "rgba(8,47,73,.22)",
            color: "#e5e7eb",
            fontSize: 12,
          }}
        >
          {detectionStatus?.text ?? detectionError}
        </div>
      )}

      {/* ── Empty state hint ──────────────────────────────────────────────── */}
      {filledCount === 0 && (
        <div
          style={{
            background: "rgba(8,12,30,.6)",
            border: "1px dashed #1f2937",
            borderRadius: 14,
            padding: "18px 24px",
            fontSize: 13,
            color: "#64748b",
            textAlign: "center",
          }}
        >
          No feeds yet — click{" "}
          <span style={{ color: "#22c55e", fontWeight: 700 }}>＋ Add feed</span>{" "}
          or click any slot below. Feeds are saved locally and persist across reloads.
        </div>
      )}

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      <div
        ref={gridRef}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${gridCfg.cols}, 1fr)`,
          gap: 6,
        }}
      >
        {visibleSlots.map((slot, i) =>
          slot ? (
            <FilledSlot
              key={`slot-${i}`}
              slot={slot}
              index={i}
              height={cellHeight}
              onEdit={() => setEditing(i)}
              onRemove={() => removeSlot(i)}
              detections={detections.get(i)}
            />
          ) : (
            <EmptySlot
              key={`empty-${i}`}
              index={i}
              height={cellHeight}
              onAdd={() => setEditing(i)}
            />
          )
        )}
      </div>

      {/* ── Slot configurator modal ───────────────────────────────────────── */}
      {editing !== null && (
        <SlotConfigurator
          slotIndex={editing}
          initial={slots[editing] ?? undefined}
          onSave={(s) => saveSlot(editing, s)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
