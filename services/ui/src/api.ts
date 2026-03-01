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
  qdrant_id: string | null; score: number; text: string;
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

// ─── WebSocket ────────────────────────────────────────────────────────────────
export function eventsWsUrl(): string {
  const u = new URL(API_BASE);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws/events";
  return u.toString();
}
