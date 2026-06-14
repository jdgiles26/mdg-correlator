/**
 * SemanticSearch — vector similarity search over ingested content.
 *
 * When ENABLE_EMBEDDINGS=true, queries pgvector-backed embeddings in Postgres
 * via the API and returns the most semantically similar text chunks.
 * When disabled, shows a graceful "not enabled" message.
 */
import React, { useState } from "react";
import { answerSearchWithLocalModel, semanticSearch, type SearchHit } from "../api";

const SOURCE_TYPES = ["all", "osint", "document", "url", "event"];

function card(border?: string): React.CSSProperties {
  return {
    background: "rgba(8,12,30,.85)",
    border: `1px solid ${border ?? "#1f2937"}`,
    borderRadius: 14,
    padding: 14,
  };
}

function scoreColour(s: number): string {
  if (s >= 0.8) return "#22c55e";
  if (s >= 0.6) return "#eab308";
  return "#64748b";
}

function HitCard({ hit }: { hit: SearchHit }) {
  const [expanded, setExpanded] = useState(false);
  const preview = hit.text.slice(0, 240);
  const hasMore = hit.text.length > 240;

  return (
    <div style={{ ...card(), display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: scoreColour(hit.score), minWidth: 48 }}>
          {(hit.score * 100).toFixed(1)}%
        </span>
        <span style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>
          {hit.source_type}
        </span>
        {hit.source_label && (
          <span style={{ fontSize: 11, color: "#94a3b8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hit.source_label}
          </span>
        )}
        {hit.ingest_id > 0 && (
          <span style={{ fontSize: 10, color: "#475569", flexShrink: 0 }}>ingest #{hit.ingest_id}</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>
        {expanded ? hit.text : preview}
        {hasMore && !expanded && "…"}
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{ fontSize: 11, color: "#38bdf8", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function SemanticSearch() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(10);
  const [sourceType, setSourceType] = useState("all");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [embeddingsEnabled, setEmbeddingsEnabled] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const [searched, setSearched] = useState(false);
  const [answer, setAnswer] = useState<{ model: string; answer: string } | null>(null);
  const [answerBusy, setAnswerBusy] = useState(false);

  async function doSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setMsg("");
    setAnswer(null);
    try {
      const res = await semanticSearch(query.trim(), topK, sourceType === "all" ? undefined : sourceType);
      setEmbeddingsEnabled(res.enabled);
      setResults(res.hits);
      setSearched(true);
      if (!res.enabled && res.message) setMsg(res.message);
    } catch (e: any) {
      setMsg(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function askLocalModel() {
    if (!query.trim() || results.length === 0) return;
    setAnswerBusy(true);
    setMsg("");
    try {
      const res = await answerSearchWithLocalModel(
        query.trim(),
        results.map((hit) => hit.text)
      );
      setAnswer(res);
    } catch (e: any) {
      setMsg(e.message || String(e));
    } finally {
      setAnswerBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ ...card(), display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ fontWeight: 800, fontSize: 14, flex: 1 }}>🔍 Semantic Search</span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>
          Vector similarity across all ingested OSINT, documents, and URLs
        </span>
      </div>

      {/* Search bar */}
      <div style={card()}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            value={query}
            onChange={(e: any) => setQuery(e.target.value)}
            onKeyDown={(e: any) => e.key === "Enter" && doSearch()}
            placeholder='e.g. "dark vessel AIS gap near chokepoint" or "border anomaly spike sector 7"'
            style={{
              flex: 1, padding: "10px 12px", borderRadius: 10,
              border: "1px solid #1f2937", background: "#050814",
              color: "#e5e7eb", outline: "none", fontSize: 13,
            }}
          />
          <button
            onClick={doSearch}
            disabled={loading || !query.trim()}
            style={{
              padding: "10px 20px", borderRadius: 10,
              border: "1px solid #38bdf8",
              background: "rgba(56,189,248,.2)", color: "#e5e7eb",
              cursor: loading || !query.trim() ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: 13,
              opacity: loading || !query.trim() ? 0.5 : 1,
            }}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, opacity: 0.6 }}>Source:</span>
          {SOURCE_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setSourceType(t)}
              style={{
                padding: "4px 10px", borderRadius: 999,
                border: `1px solid ${t === sourceType ? "#38bdf8" : "#1f2937"}`,
                background: t === sourceType ? "rgba(56,189,248,.15)" : "rgba(8,12,30,.85)",
                color: "#e5e7eb", cursor: "pointer", fontSize: 11,
                fontWeight: t === sourceType ? 700 : 400,
              }}
            >
              {t}
            </button>
          ))}
          <span style={{ fontSize: 12, opacity: 0.6, marginLeft: 8 }}>Top K:</span>
          {[5, 10, 20].map(k => (
            <button
              key={k}
              onClick={() => setTopK(k)}
              style={{
                padding: "4px 10px", borderRadius: 999,
                border: `1px solid ${k === topK ? "#38bdf8" : "#1f2937"}`,
                background: k === topK ? "rgba(56,189,248,.15)" : "rgba(8,12,30,.85)",
                color: "#e5e7eb", cursor: "pointer", fontSize: 11,
                fontWeight: k === topK ? 700 : 400,
              }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      {msg && (
        <div style={{ ...card(embeddingsEnabled === false ? "#f59e0b" : "#ef4444"), color: "#fde68a", fontSize: 12 }}>
          {embeddingsEnabled === false ? "⚠ " : "✗ "}{msg}
        </div>
      )}

      {embeddingsEnabled === false && !msg && (
        <div style={{ ...card("#f59e0b"), color: "#fde68a", fontSize: 12 }}>
          ⚠ Embeddings are disabled in AI Controls.
        </div>
      )}

      {/* Results */}
      {searched && embeddingsEnabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              {results.length} results for "{query}"
            </div>
            <button
              onClick={askLocalModel}
              disabled={answerBusy || results.length === 0}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid #22c55e",
                background: "rgba(34,197,94,.16)",
                color: "#e5e7eb",
                cursor: answerBusy || results.length === 0 ? "not-allowed" : "pointer",
                opacity: answerBusy || results.length === 0 ? 0.5 : 1,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {answerBusy ? "Asking local model…" : "Ask local Ollama"}
            </button>
          </div>
          {answer && (
            <div style={{ ...card("#22c55e"), lineHeight: 1.6 }}>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>
                Answered by {answer.model}
              </div>
              <div style={{ fontSize: 13, color: "#dbe4f0", whiteSpace: "pre-wrap" }}>
                {answer.answer}
              </div>
            </div>
          )}
          {results.length === 0 && (
            <div style={{ ...card(), fontSize: 13, opacity: 0.6, textAlign: "center", padding: 24 }}>
              No results above similarity threshold. Try a different query or ingest more content.
            </div>
          )}
          {results.map((hit, i) => <HitCard key={i} hit={hit} />)}
        </div>
      )}

      {!searched && (
        <div style={{ ...card(), padding: 24, textAlign: "center", opacity: 0.5, fontSize: 13 }}>
          Enter a natural-language query above to search across all ingested intelligence.
          <br />
          <span style={{ fontSize: 11 }}>Examples: "vessel behaviour anomaly", "border surveillance alert", "supply chain disruption"</span>
        </div>
      )}
    </div>
  );
}
