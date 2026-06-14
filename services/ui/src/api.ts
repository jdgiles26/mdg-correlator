const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";
export const HLS_BASE = import.meta.env.VITE_HLS_BASE || "http://localhost:8888";

// ─── Feeds ────────────────────────────────────────────────────────────────────
export type Feed = { id: number; name: string; rtsp_url: string; enabled: boolean; hls_url: string };

export async function listFeeds(): Promise<Feed[]> {
  const r = await fetch(`${API_BASE}/api/feeds`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function addFeed(name: string, rtsp_url: string): Promise<Feed> {
  const r = await fetch(`${API_BASE}/api/feeds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, rtsp_url, enabled: true })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function toggleFeed(id: number): Promise<Feed> {
  const r = await fetch(`${API_BASE}/api/feeds/${id}/toggle`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Ingest ───────────────────────────────────────────────────────────────────
export async function uploadFile(file: File): Promise<any> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${API_BASE}/api/ingest/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function ingestUrl(url: string): Promise<any> {
  const r = await fetch(`${API_BASE}/api/ingest/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Events ───────────────────────────────────────────────────────────────────
export type MissionEvent = {
  id: number;
  topic: string;
  severity: string;
  source: string;
  payload: any;
  score?: number | null;
  ts: string;
};

export async function listEvents(limit: number = 100): Promise<MissionEvent[]> {
  const r = await fetch(`${API_BASE}/api/events?limit=${encodeURIComponent(String(limit))}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Graph ────────────────────────────────────────────────────────────────────
export type GraphEntity = {
  id: number; entity_type: string; name: string;
  external_id: string | null; attributes: any; confidence: number; created_at: string;
};
export type GraphEdge = {
  id: number; src_id: number; dst_id: number;
  relation: string; confidence: number; created_at: string;
};

export async function listEntities(params?: { q?: string; entity_type?: string; limit?: number }): Promise<{ total: number; items: GraphEntity[] }> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.entity_type) qs.set("entity_type", params.entity_type);
  if (params?.limit) qs.set("limit", String(params.limit));
  const r = await fetch(`${API_BASE}/api/graph/entities?${qs}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function traverseEntity(id: number, depth: number = 1, relation?: string): Promise<{ nodes: GraphEntity[]; edges: GraphEdge[]; focal_id: number }> {
  const qs = new URLSearchParams({ depth: String(depth) });
  if (relation) qs.set("relation", relation);
  const r = await fetch(`${API_BASE}/api/graph/traverse/${id}?${qs}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createEntity(body: Partial<GraphEntity>): Promise<GraphEntity> {
  const r = await fetch(`${API_BASE}/api/graph/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createEdge(body: { src_id: number; dst_id: number; relation: string; confidence?: number }): Promise<GraphEdge> {
  const r = await fetch(`${API_BASE}/api/graph/edges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Search ───────────────────────────────────────────────────────────────────
export type SearchHit = {
  score: number; text: string;
  source_label: string | null; source_type: string; ingest_id: number; chunk_id: number;
};
export type SearchResult = { enabled: boolean; hits: SearchHit[]; query: string; message?: string };

export async function semanticSearch(query: string, topK: number = 10, sourceType?: string): Promise<SearchResult> {
  const r = await fetch(`${API_BASE}/api/search/semantic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: topK, source_type: sourceType ?? null })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
export type Task = {
  id: number; title: string; description: string | null; status: string; priority: string;
  source_event_id: number | null; source_entity_id: number | null;
  assignee: string | null; due_ts: string | null; outcome: string | null;
  created_by: string; created_at: string; updated_at: string;
};

export async function listTasks(params?: { status?: string; priority?: string }): Promise<{ total: number; items: Task[] }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.priority) qs.set("priority", params.priority);
  const r = await fetch(`${API_BASE}/api/tasks?${qs}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createTask(body: { title: string; description?: string; priority?: string; source_event_id?: number; assignee?: string }): Promise<Task> {
  const r = await fetch(`${API_BASE}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function patchTask(id: number, body: { status?: string; assignee?: string; outcome?: string; note?: string; actor?: string }): Promise<Task> {
  const r = await fetch(`${API_BASE}/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getTask(id: number): Promise<Task & { audit_trail: any[] }> {
  const r = await fetch(`${API_BASE}/api/tasks/${id}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export type TaskReport = {
  id: number;
  task_id: number;
  source_event_id: number | null;
  report_type: string;
  title: string;
  summary: string | null;
  threat_detected: boolean;
  threat_risk: string;
  risk_score: number;
  confidence_score: number;
  generation_mode: string;
  model_name: string | null;
  correlated_events_count: number;
  related_sources_count: number;
  report_markdown: string | null;
  report_payload: any;
  created_at: string | null;
  updated_at: string | null;
};

export async function listReports(taskId?: number): Promise<{ items: TaskReport[] }> {
  const qs = new URLSearchParams();
  if (typeof taskId === "number") qs.set("task_id", String(taskId));
  const r = await fetch(`${API_BASE}/api/reports?${qs.toString()}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getReport(id: number): Promise<TaskReport> {
  const r = await fetch(`${API_BASE}/api/reports/${id}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function generateTaskReport(taskId: number): Promise<TaskReport> {
  const r = await fetch(`${API_BASE}/api/reports/generate/task/${taskId}`, {
    method: "POST",
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function downloadTaskReport(id: number): Promise<void> {
  const r = await fetch(`${API_BASE}/api/reports/${id}/download`);
  if (!r.ok) throw new Error(await r.text());
  const blob = await r.blob();
  const disposition = r.headers.get("content-disposition") || "";
  const match = disposition.match(/filename=\"?([^"]+)\"?/i);
  const filename = match?.[1] || `task-report-${id}.md`;
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

// ─── Audit ────────────────────────────────────────────────────────────────────
export async function listAudit(params?: { actor?: string; action?: string; limit?: number }): Promise<{ total: number; items: any[] }> {
  const qs = new URLSearchParams();
  if (params?.actor) qs.set("actor", params.actor);
  if (params?.action) qs.set("action", params.action);
  if (params?.limit) qs.set("limit", String(params.limit));
  const r = await fetch(`${API_BASE}/api/audit?${qs}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Detection ────────────────────────────────────────────────────────────────
export type Detection = {
  class_id: number;
  class_name: string;
  score: number;
  bbox: { x: number; y: number; width: number; height: number };
};

export type DetectionResponse = {
  detections: Detection[];
  model: string;
};

export type DetectionHealth = {
  available: boolean;
  pil_available: boolean;
  model_loaded: boolean;
};

export async function detectObjects(imageBase64: string, threshold: number = 0.3): Promise<DetectionResponse> {
  const r = await fetch(`${API_BASE}/api/detect/frame`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64, threshold })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function publishUIDetectionEvent(body: {
  feed: string;
  source_url?: string | null;
  preset?: string | null;
  cell_index?: number | null;
  detections: Detection[];
}): Promise<{ ok: boolean; published: boolean; topic?: string; score?: number; count?: number; feed?: string; reason?: string }> {
  const r = await fetch(`${API_BASE}/api/detect/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function detectionHealth(): Promise<DetectionHealth> {
  const r = await fetch(`${API_BASE}/api/detect/health`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── AI runtime controls ─────────────────────────────────────────────────────
export type AISettings = {
  ollama_base_url: string;
  ollama_generate_model: string | null;
  embeddings_enabled: boolean;
  background_inference_enabled: boolean;
  background_inference_fps: number;
  background_detection_confidence: number;
  ui_detection_enabled: boolean;
  ui_detection_fps: number;
  ui_detection_threshold: number;
  predictor_enabled: boolean;
  predictor_min_events: number;
  predictor_min_anomaly_score: number;
  predictor_cooldown_sec: number;
  predictor_emit_empty_windows: boolean;
  correlator_enabled: boolean;
  correlator_min_score: number;
  correlator_cooldown_sec: number;
  ner_enabled: boolean;
  task_alerts_enabled: boolean;
  task_auto_report_enabled: boolean;
  task_report_match_threshold: number;
  task_report_lookback_hours: number;
  task_report_max_events: number;
  task_event_cooldown_sec: number;
};

export type OllamaModel = {
  name: string;
  size: number | null;
  modified_at: string | null;
  digest: string | null;
  kind: "generate" | "embedding";
  details: Record<string, unknown>;
};

export type OllamaStatus = {
  base_url: string;
  reachable: boolean;
  error: string | null;
  models: OllamaModel[];
  generate_models: string[];
};

export type AISettingsResponse = {
  settings: AISettings;
  ollama: OllamaStatus;
};

export type SystemStatus = {
  api: { ok: boolean; version: string };
  ollama: {
    reachable: boolean;
    base_url: string | null;
    model: string | null;
    generate_models: string[];
    error: string | null;
  };
  detections: {
    mediapipe_available: boolean;
    pil_available: boolean;
    model_loaded: boolean;
    ui_detection_enabled: boolean;
    background_inference_enabled: boolean;
  };
  runtime: {
    embeddings_enabled: boolean;
    task_alerts_enabled: boolean;
    task_auto_report_enabled: boolean;
    report_generation_ready: boolean;
    open_high_priority_tasks: number;
    saved_reports: number;
  };
  feed_issues: Array<{
    feed: string;
    topic: string;
    severity: string;
    error: string;
    hint?: string | null;
    ts?: string | null;
  }>;
};

export async function getAISettings(): Promise<AISettingsResponse> {
  const r = await fetch(`${API_BASE}/api/ai/settings`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateAISettings(body: AISettings): Promise<AISettingsResponse> {
  const r = await fetch(`${API_BASE}/api/ai/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getAIBrief(limit: number = 20): Promise<{ model: string; summary: string; events_considered: number }> {
  const r = await fetch(`${API_BASE}/api/ai/brief?limit=${encodeURIComponent(String(limit))}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const r = await fetch(`${API_BASE}/api/system/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function answerSearchWithLocalModel(
  query: string,
  context: string[]
): Promise<{ model: string; answer: string }> {
  const r = await fetch(`${API_BASE}/api/ai/search-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, context }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
export function eventsWsUrl(): string {
  const u = new URL(API_BASE);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws/events";
  return u.toString();
}
