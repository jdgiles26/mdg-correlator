import React from "react";
import type { AISettings, OllamaStatus } from "../api";

const GUIDE_SECTIONS: Array<{ title: string; items: Array<{ name: string; detail: string }> }> = [
  {
    title: "Ollama",
    items: [
      { name: "Base URL", detail: "The local Ollama endpoint used for report generation and mission briefs." },
      { name: "Generate model", detail: "The local model used whenever the dashboard asks for an analyst narrative." },
    ],
  },
  {
    title: "Background AI",
    items: [
      { name: "Background video inference", detail: "Turns worker-side live-stream detection on or off across registered feeds." },
      { name: "Feed inference FPS", detail: "Limits how often the worker samples each feed for detections." },
      { name: "Detection confidence", detail: "Suppresses weaker worker detections below the selected confidence floor." },
      { name: "Semantic search embeddings", detail: "Allows ingested text and URLs to participate in semantic search and task-source matching." },
      { name: "spaCy graph extraction", detail: "Creates entity graph nodes from ingested text and live detections." },
    ],
  },
  {
    title: "UI Detection",
    items: [
      { name: "Manual grid detection", detail: "Enables browser-side multi-grid detection over the rendered video wall." },
      { name: "Grid detection FPS", detail: "Controls how often the dashboard captures the grid for manual detection." },
      { name: "Grid detection threshold", detail: "Suppresses weaker browser-side detections below the selected threshold." },
    ],
  },
  {
    title: "Alerting",
    items: [
      { name: "Predictor alerts", detail: "Publishes anomaly forecasts from rolling detection-rate windows." },
      { name: "Min predictor events", detail: "Requires at least this many detections in a window before forecasting." },
      { name: "Min anomaly score", detail: "Only predictor windows above this score become alerts." },
      { name: "Predictor cooldown", detail: "Prevents repeated forecast alerts for the same metric." },
      { name: "Emit empty predictor windows", detail: "Keeps forecasting active even when a window contains no detections." },
      { name: "Correlator cluster alerts", detail: "Raises cross-feed anomaly clusters when multiple feeds spike together." },
      { name: "Cluster score threshold", detail: "Minimum score a detection cluster must reach before it becomes an alert." },
      { name: "Cluster cooldown", detail: "Prevents the correlator from emitting duplicate cluster alerts too frequently." },
    ],
  },
  {
    title: "Task Intelligence",
    items: [
      { name: "Task alerting", detail: "Publishes a dashboard alert when a task matches ingested sources or correlated events." },
      { name: "Auto-generate reports", detail: "Creates and saves a downloadable task intelligence report as soon as a task is created." },
      { name: "Source match threshold", detail: "Minimum semantic similarity required before ingested content is treated as related evidence." },
      { name: "Correlation lookback", detail: "How many hours of persisted events the task report scans for present or past related activity." },
      { name: "Max correlated events", detail: "Caps how many correlated events are pulled into the report and dashboard summaries." },
      { name: "Event cooldown", detail: "Suppresses duplicate task alerts/reports when the same task keeps matching the same live signal repeatedly." },
    ],
  },
];

interface AIControlsPanelProps {
  settings: AISettings;
  ollama: OllamaStatus | null;
  busy?: boolean;
  message?: string;
  brief?: { model: string; summary: string; events_considered: number } | null;
  briefBusy?: boolean;
  onChange: (next: AISettings) => void;
  onRefresh: () => void;
  onSave: () => void;
  onGenerateBrief: () => void;
}

export function AIControlsPanel({
  settings,
  ollama,
  busy = false,
  message,
  brief,
  briefBusy = false,
  onChange,
  onRefresh,
  onSave,
  onGenerateBrief,
}: AIControlsPanelProps) {
  const setBool = (key: keyof AISettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...settings, [key]: e.target.checked });
  const setText = (key: keyof AISettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...settings, [key]: e.target.value });
  const setNumber = (key: keyof AISettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    onChange({ ...settings, [key]: Number.isFinite(value) ? value : 0 });
  };

  return (
    <div style={card()}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>AI Controls</div>
          <div style={{ fontSize: 12, opacity: 0.68, marginTop: 4 }}>
            Local Ollama connectivity plus throttles for detection, alerting, and background AI load.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onRefresh} style={button(false)}>Refresh status</button>
          <button onClick={onSave} disabled={busy} style={button(true)}>
            {busy ? "Saving…" : "Save controls"}
          </button>
        </div>
      </div>

      <div style={{ ...section(), marginTop: 12 }}>
        <div style={sectionTitle()}>Control Guide</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          These settings are persisted in the dashboard runtime config and immediately affect background workers, browser detection, alerting, and task reporting.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, marginTop: 12 }}>
          {GUIDE_SECTIONS.map((sectionDef) => (
            <div key={sectionDef.title} style={{ background: "#050814", border: "1px solid #1f2937", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{sectionDef.title}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {sectionDef.items.map((item) => (
                  <div key={item.name}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#e5e7eb" }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>{item.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...section(), marginTop: 12 }}>
        <div style={sectionTitle()}>Ollama</div>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.7fr", gap: 12 }}>
          <label style={field()}>
            Base URL
            <input value={settings.ollama_base_url} onChange={setText("ollama_base_url")} style={input()} />
          </label>
          <label style={field()}>
            Generate model
            <select
              value={settings.ollama_generate_model ?? ""}
              onChange={(e) => onChange({ ...settings, ollama_generate_model: e.target.value || null })}
              style={input()}
            >
              <option value="">Select local model</option>
              {(ollama?.generate_models ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={badge(!!ollama?.reachable)}>
            {ollama?.reachable ? "Connected" : "Disconnected"}
          </span>
          <span style={{ fontSize: 12, opacity: 0.75 }}>
            {(ollama?.generate_models ?? []).length} local generate model{(ollama?.generate_models ?? []).length === 1 ? "" : "s"}
          </span>
          {ollama?.error && (
            <span style={{ fontSize: 12, color: "#fca5a5" }}>{ollama.error}</span>
          )}
        </div>
      </div>

      <div style={{ ...section(), marginTop: 12 }}>
        <div style={sectionTitle()}>Background AI</div>
        <div style={grid()}>
          <label style={checkbox()}>
            <input type="checkbox" checked={settings.background_inference_enabled} onChange={setBool("background_inference_enabled")} />
            Background video inference
          </label>
          <label style={field()}>
            Feed inference FPS
            <input type="number" min="0.2" max="5" step="0.1" value={settings.background_inference_fps} onChange={setNumber("background_inference_fps")} style={input()} />
          </label>
          <label style={field()}>
            Detection confidence
            <input type="number" min="0.05" max="0.99" step="0.05" value={settings.background_detection_confidence} onChange={setNumber("background_detection_confidence")} style={input()} />
          </label>
          <label style={checkbox()}>
            <input type="checkbox" checked={settings.embeddings_enabled} onChange={setBool("embeddings_enabled")} />
            Semantic search embeddings
          </label>
          <label style={checkbox()}>
            <input type="checkbox" checked={settings.ner_enabled} onChange={setBool("ner_enabled")} />
            spaCy graph extraction
          </label>
        </div>
      </div>

      <div style={{ ...section(), marginTop: 12 }}>
        <div style={sectionTitle()}>UI Detection</div>
        <div style={grid()}>
          <label style={checkbox()}>
            <input type="checkbox" checked={settings.ui_detection_enabled} onChange={setBool("ui_detection_enabled")} />
            Manual grid detection
          </label>
          <label style={field()}>
            Grid detection FPS
            <input type="number" min="0.2" max="5" step="0.1" value={settings.ui_detection_fps} onChange={setNumber("ui_detection_fps")} style={input()} />
          </label>
          <label style={field()}>
            Grid detection threshold
            <input type="number" min="0.05" max="0.99" step="0.05" value={settings.ui_detection_threshold} onChange={setNumber("ui_detection_threshold")} style={input()} />
          </label>
        </div>
      </div>

      <div style={{ ...section(), marginTop: 12 }}>
        <div style={sectionTitle()}>Alerting</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          Predictor windows watch rate changes on each feed, while the correlator watches for multi-feed spikes happening together.
        </div>
        <div style={grid()}>
          <label style={checkbox()}>
            <input type="checkbox" checked={settings.predictor_enabled} onChange={setBool("predictor_enabled")} />
            Predictor alerts
          </label>
          <label style={field()}>
            Min predictor events
            <input type="number" min="1" max="100" step="1" value={settings.predictor_min_events} onChange={setNumber("predictor_min_events")} style={input()} />
          </label>
          <label style={field()}>
            Min anomaly score
            <input type="number" min="0" max="1" step="0.05" value={settings.predictor_min_anomaly_score} onChange={setNumber("predictor_min_anomaly_score")} style={input()} />
          </label>
          <label style={field()}>
            Predictor cooldown (sec)
            <input type="number" min="0" max="3600" step="10" value={settings.predictor_cooldown_sec} onChange={setNumber("predictor_cooldown_sec")} style={input()} />
          </label>
          <label style={checkbox()}>
            <input type="checkbox" checked={settings.predictor_emit_empty_windows} onChange={setBool("predictor_emit_empty_windows")} />
            Emit empty predictor windows
          </label>
          <label style={checkbox()}>
            <input type="checkbox" checked={settings.correlator_enabled} onChange={setBool("correlator_enabled")} />
            Correlator cluster alerts
          </label>
          <label style={field()}>
            Cluster score threshold
            <input type="number" min="0" max="1" step="0.05" value={settings.correlator_min_score} onChange={setNumber("correlator_min_score")} style={input()} />
          </label>
          <label style={field()}>
            Cluster cooldown (sec)
            <input type="number" min="0" max="3600" step="10" value={settings.correlator_cooldown_sec} onChange={setNumber("correlator_cooldown_sec")} style={input()} />
          </label>
        </div>
      </div>

      <div style={{ ...section(), marginTop: 12 }}>
        <div style={sectionTitle()}>Task Intelligence</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          These controls govern how newly created tasks match against ingested articles, uploaded media metadata, and persisted live-stream events to create alerts and saved reports.
        </div>
        <div style={grid()}>
          <label style={checkbox()}>
            <input type="checkbox" checked={settings.task_alerts_enabled} onChange={setBool("task_alerts_enabled")} />
            Task intelligence alerts
          </label>
          <label style={checkbox()}>
            <input type="checkbox" checked={settings.task_auto_report_enabled} onChange={setBool("task_auto_report_enabled")} />
            Auto-generate task reports
          </label>
          <label style={field()}>
            Source match threshold
            <input type="number" min="0.05" max="0.99" step="0.05" value={settings.task_report_match_threshold} onChange={setNumber("task_report_match_threshold")} style={input()} />
          </label>
          <label style={field()}>
            Correlation lookback (hours)
            <input type="number" min="1" max="720" step="1" value={settings.task_report_lookback_hours} onChange={setNumber("task_report_lookback_hours")} style={input()} />
          </label>
          <label style={field()}>
            Max correlated events
            <input type="number" min="1" max="50" step="1" value={settings.task_report_max_events} onChange={setNumber("task_report_max_events")} style={input()} />
          </label>
          <label style={field()}>
            Event cooldown (sec)
            <input type="number" min="0" max="3600" step="5" value={settings.task_event_cooldown_sec} onChange={setNumber("task_event_cooldown_sec")} style={input()} />
          </label>
        </div>
      </div>

      <div style={{ ...section(), marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={sectionTitle()}>Local Model Brief</div>
          <button
            onClick={onGenerateBrief}
            disabled={briefBusy || !ollama?.reachable || !(settings.ollama_generate_model || ollama?.generate_models?.length)}
            style={button(false)}
          >
            {briefBusy ? "Generating…" : "Generate operator brief"}
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          Uses the selected local Ollama generate model and recent persisted events. Repeated low-signal chatter is intentionally down-weighted.
        </div>
        {brief && (
          <div style={{ marginTop: 10, background: "#050814", border: "1px solid #1f2937", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 8 }}>
              {brief.model} • {brief.events_considered} events
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "#dbe4f0", whiteSpace: "pre-wrap" }}>
              {brief.summary}
            </div>
          </div>
        )}
      </div>

      {message && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#cbd5e1" }}>{message}</div>
      )}
    </div>
  );
}

function card(): React.CSSProperties {
  return {
    background: "rgba(8,12,30,.85)",
    border: "1px solid #1f2937",
    borderRadius: 16,
    padding: 16,
  };
}

function section(): React.CSSProperties {
  return {
    background: "#070b1b",
    border: "1px solid #1f2937",
    borderRadius: 14,
    padding: 14,
  };
}

function sectionTitle(): React.CSSProperties {
  return {
    fontWeight: 700,
    fontSize: 13,
  };
}

function grid(): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginTop: 10,
  };
}

function field(): React.CSSProperties {
  return {
    display: "grid",
    gap: 6,
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: 700,
  };
}

function checkbox(): React.CSSProperties {
  return {
    display: "flex",
    gap: 8,
    alignItems: "center",
    fontSize: 13,
    color: "#e5e7eb",
  };
}

function input(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #1f2937",
    background: "#050814",
    color: "#e5e7eb",
    outline: "none",
  };
}

function button(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 999,
    border: `1px solid ${primary ? "#38bdf8" : "#1f2937"}`,
    background: primary ? "rgba(56,189,248,.18)" : "rgba(8,12,30,.85)",
    color: "#e5e7eb",
    cursor: "pointer",
  };
}

function badge(ok: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 999,
    background: ok ? "rgba(34,197,94,.18)" : "rgba(239,68,68,.18)",
    color: ok ? "#86efac" : "#fca5a5",
    fontSize: 11,
    fontWeight: 700,
  };
}
