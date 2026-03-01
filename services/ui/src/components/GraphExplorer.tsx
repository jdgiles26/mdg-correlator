/**
 * GraphExplorer — Knowledge-graph traversal UI.
 *
 * Allows operators to:
 *  - Search entities by name / type
 *  - Select a focal entity and expand 1 or 2 hops
 *  - Filter by relationship type
 *  - See entity attributes and linked tasks/events
 */
import React, { useCallback, useEffect, useState } from "react";
import { listEntities, traverseEntity, type GraphEntity, type GraphEdge } from "../api";

// ─── Entity type colours ──────────────────────────────────────────────────────
const TYPE_COLOUR: Record<string, string> = {
  Asset:       "#38bdf8",
  Sensor:      "#818cf8",
  Feed:        "#a78bfa",
  Observation: "#fb923c",
  Track:       "#f43f5e",
  Event:       "#ef4444",
  Location:    "#22c55e",
  Mission:     "#84cc16",
  Task:        "#eab308",
  Actor:       "#06b6d4",
  Document:    "#94a3b8",
  Media:       "#64748b",
};

function typeColour(t: string) {
  return TYPE_COLOUR[t] ?? "#94a3b8";
}

const ENTITY_TYPES = [
  "All", "Asset", "Sensor", "Feed", "Observation", "Track",
  "Event", "Location", "Mission", "Task", "Actor", "Document", "Media",
];

const RELATION_PRESETS = ["*", "PRODUCED","MENTIONS","TRIGGERED_BY","OCCURS_AT","ASSIGNED_TO",
  "HAS_SENSOR","SUPPORTS","CREATED_FROM","RELATED_TO","OUTCOME"];

// ─── Shared style helpers ─────────────────────────────────────────────────────
function card(border?: string): React.CSSProperties {
  return {
    background: "rgba(8,12,30,.85)",
    border: `1px solid ${border ?? "#1f2937"}`,
    borderRadius: 14,
    padding: 14,
  };
}
function input(): React.CSSProperties {
  return {
    padding: "8px 11px", borderRadius: 10,
    border: "1px solid #1f2937", background: "#050814",
    color: "#e5e7eb", outline: "none", fontSize: 13, width: "100%",
    boxSizing: "border-box" as any,
  };
}
function chip(active?: boolean): React.CSSProperties {
  return {
    padding: "4px 10px", borderRadius: 999,
    border: `1px solid ${active ? "#38bdf8" : "#1f2937"}`,
    background: active ? "rgba(56,189,248,.15)" : "rgba(8,12,30,.85)",
    color: "#e5e7eb", cursor: "pointer", fontSize: 11,
    fontWeight: active ? 700 : 400,
  };
}

// ─── Node card ────────────────────────────────────────────────────────────────
function NodeCard({ node, isFocal, onClick }: { node: GraphEntity; isFocal: boolean; onClick: () => void }) {
  const col = typeColour(node.entity_type);
  return (
    <div
      onClick={onClick}
      style={{
        border: `1px solid ${isFocal ? col : "#1f2937"}`,
        borderLeft: `3px solid ${col}`,
        borderRadius: 10,
        padding: "8px 12px",
        cursor: "pointer",
        background: isFocal ? "rgba(56,189,248,.06)" : "rgba(8,12,30,.85)",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: col, fontWeight: 700, textTransform: "uppercase" }}>
          {node.entity_type}
        </span>
        <span style={{ fontSize: 10, color: "#64748b" }}>#{node.id}</span>
        <span style={{ fontSize: 10, color: "#64748b", marginLeft: "auto" }}>
          {(node.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {node.name}
      </div>
      {node.external_id && (
        <div style={{ fontSize: 10, color: "#64748b" }}>ext: {node.external_id}</div>
      )}
    </div>
  );
}

// ─── Edge row ─────────────────────────────────────────────────────────────────
function EdgeRow({ edge, nodes }: { edge: GraphEdge; nodes: GraphEntity[] }) {
  const src = nodes.find(n => n.id === edge.src_id);
  const dst = nodes.find(n => n.id === edge.dst_id);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "#94a3b8", padding: "3px 0", borderBottom: "1px solid #0f1929" }}>
      <span style={{ color: typeColour(src?.entity_type ?? ""), fontWeight: 700, minWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {src?.name ?? `#${edge.src_id}`}
      </span>
      <span style={{ color: "#38bdf8", flexShrink: 0, fontSize: 10 }}>—{edge.relation}→</span>
      <span style={{ color: typeColour(dst?.entity_type ?? ""), fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {dst?.name ?? `#${edge.dst_id}`}
      </span>
      <span style={{ color: "#475569", flexShrink: 0 }}>{(edge.confidence * 100).toFixed(0)}%</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function GraphExplorer() {
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState("All");
  const [searchResults, setSearchResults] = useState<GraphEntity[]>([]);
  const [searching, setSearching] = useState(false);

  const [focalId, setFocalId] = useState<number | null>(null);
  const [depth, setDepth] = useState(1);
  const [relation, setRelation] = useState("*");
  const [subgraph, setSubgraph] = useState<{ nodes: GraphEntity[]; edges: GraphEdge[] } | null>(null);
  const [traversing, setTraversing] = useState(false);
  const [err, setErr] = useState("");

  const doSearch = useCallback(async () => {
    setSearching(true);
    setErr("");
    try {
      const res = await listEntities({
        q: query || undefined,
        entity_type: filterType === "All" ? undefined : filterType,
        limit: 50,
      });
      setSearchResults(res.items);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSearching(false);
    }
  }, [query, filterType]);

  useEffect(() => { doSearch(); }, [filterType]);

  const doTraverse = useCallback(async (id: number) => {
    setTraversing(true);
    setErr("");
    try {
      const res = await traverseEntity(id, depth, relation === "*" ? undefined : relation);
      setSubgraph(res);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setTraversing(false);
    }
  }, [depth, relation]);

  function selectFocal(id: number) {
    setFocalId(id);
    doTraverse(id);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ ...card(), display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, fontSize: 14, flex: 1 }}>🕸 Knowledge Graph Explorer</span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>
          {searchResults.length} entities · click to expand subgraph
        </span>
      </div>

      {err && <div style={{ ...card("#ef4444"), color: "#fca5a5", fontSize: 12 }}>⚠ {err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12 }}>
        {/* ── Left: search + results ────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Search bar */}
          <div style={card()}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, opacity: 0.7 }}>SEARCH</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={query}
                onChange={(e: any) => setQuery(e.target.value)}
                onKeyDown={(e: any) => e.key === "Enter" && doSearch()}
                placeholder="Entity name…"
                style={input()}
              />
              <button onClick={doSearch} style={{ ...chip(false), flexShrink: 0, padding: "8px 12px" }}>
                {searching ? "…" : "⌕"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
              {ENTITY_TYPES.map(t => (
                <button key={t} onClick={() => setFilterType(t)} style={chip(filterType === t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Search results */}
          <div style={{ ...card(), overflow: "auto", maxHeight: 480 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
              RESULTS ({searchResults.length})
            </div>
            {searchResults.length === 0 && (
              <div style={{ fontSize: 12, opacity: 0.5 }}>
                No entities yet. They appear after ingesting OSINT or video feeds.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {searchResults.map(n => (
                <NodeCard
                  key={n.id}
                  node={n}
                  isFocal={n.id === focalId}
                  onClick={() => selectFocal(n.id)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: subgraph ───────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Traversal controls */}
          <div style={{ ...card(), display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Depth:</span>
            {[1, 2].map(d => (
              <button key={d} onClick={() => { setDepth(d); focalId && doTraverse(focalId); }}
                style={chip(depth === d)}>{d} hop{d > 1 ? "s" : ""}</button>
            ))}
            <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 8 }}>Relation:</span>
            {RELATION_PRESETS.map(r => (
              <button key={r} onClick={() => { setRelation(r); focalId && doTraverse(focalId); }}
                style={chip(relation === r)}>{r}</button>
            ))}
            {traversing && <span style={{ fontSize: 11, opacity: 0.5 }}>loading…</span>}
          </div>

          {!focalId && (
            <div style={{ ...card(), padding: 24, textAlign: "center", opacity: 0.5, fontSize: 13 }}>
              Select an entity on the left to expand its subgraph
            </div>
          )}

          {subgraph && focalId && (
            <>
              {/* Nodes */}
              <div style={card()}>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
                  NODES ({subgraph.nodes.length})
                  {subgraph.nodes.find(n => n.id === focalId) &&
                    <span style={{ color: "#38bdf8", marginLeft: 6 }}>focal: {subgraph.nodes.find(n => n.id === focalId)?.name}</span>
                  }
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                  {subgraph.nodes.map(n => (
                    <NodeCard key={n.id} node={n} isFocal={n.id === focalId} onClick={() => selectFocal(n.id)} />
                  ))}
                </div>
              </div>

              {/* Edges */}
              <div style={{ ...card(), maxHeight: 300, overflowY: "auto" }}>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
                  RELATIONSHIPS ({subgraph.edges.length})
                </div>
                {subgraph.edges.map(e => (
                  <EdgeRow key={e.id} edge={e} nodes={subgraph.nodes} />
                ))}
                {subgraph.edges.length === 0 && (
                  <div style={{ fontSize: 12, opacity: 0.5 }}>No relationships for this entity yet.</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
