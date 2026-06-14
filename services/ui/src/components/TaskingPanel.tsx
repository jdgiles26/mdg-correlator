/**
 * TaskingPanel — Operator tasking workflow.
 *
 * - View all tasks (filterable by status / priority)
 * - Create task from an event or manually
 * - Update status, assign, close with outcome
 * - Full audit trail per task
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  listTasks,
  createTask,
  patchTask,
  getTask,
  listReports,
  generateTaskReport,
  downloadTaskReport,
  type Task,
  type TaskReport,
} from "../api";

// ─── Styles ───────────────────────────────────────────────────────────────────
function card(border?: string): React.CSSProperties {
  return {
    background: "rgba(8,12,30,.85)",
    border: `1px solid ${border ?? "#1f2937"}`,
    borderRadius: 12,
    padding: 12,
  };
}
function inp(): React.CSSProperties {
  return {
    padding: "8px 11px", borderRadius: 8,
    border: "1px solid #1f2937", background: "#050814",
    color: "#e5e7eb", outline: "none", fontSize: 13,
    width: "100%", boxSizing: "border-box" as any,
  };
}
function btn(active?: boolean, colour?: string): React.CSSProperties {
  const c = colour ?? (active ? "#38bdf8" : "#1f2937");
  return {
    padding: "5px 12px", borderRadius: 999,
    border: `1px solid ${c}`,
    background: active ? `${c}22` : "rgba(8,12,30,.85)",
    color: active ? c : "#e5e7eb",
    cursor: "pointer", fontSize: 12, fontWeight: active ? 700 : 400,
  };
}

const STATUS_COLOURS: Record<string, string> = {
  open: "#38bdf8",
  in_progress: "#f59e0b",
  closed: "#22c55e",
  cancelled: "#64748b",
};
const PRIORITY_COLOURS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  normal: "#38bdf8",
  low: "#64748b",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: STATUS_COLOURS[status] ?? "#94a3b8",
      border: `1px solid ${STATUS_COLOURS[status] ?? "#1f2937"}`,
      borderRadius: 4, padding: "1px 6px", textTransform: "uppercase",
    }}>
      {status.replace("_", " ")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: PRIORITY_COLOURS[priority] ?? "#94a3b8",
      marginLeft: 4,
    }}>
      {priority.toUpperCase()}
    </span>
  );
}

// ─── Create task modal ────────────────────────────────────────────────────────
function CreateModal({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [priority, setPriority] = useState("normal");
  const [assignee, setAssignee] = useState("");
  const [sourceEventId, setSourceEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const parsedSourceEventId = Number(sourceEventId);
      await createTask({
        title: title.trim(),
        description: desc || undefined,
        priority,
        assignee: assignee || undefined,
        source_event_id: Number.isFinite(parsedSourceEventId) && parsedSourceEventId > 0 ? parsedSourceEventId : undefined,
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: "#0b1024", border: "1px solid #1f2937", borderRadius: 16, padding: 24, width: 480, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15, display: "flex", justifyContent: "space-between" }}>
          <span>＋ Create Task</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20 }}>×</button>
        </div>
        {err && <div style={{ color: "#fca5a5", fontSize: 12 }}>{err}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>Title *</label>
          <input value={title} onChange={(e: any) => setTitle(e.target.value)} style={inp()} placeholder="Investigate anomaly cluster" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>Description</label>
          <textarea value={desc} onChange={(e: any) => setDesc(e.target.value)} rows={3} style={{ ...inp(), resize: "vertical" }} placeholder="What needs to be done…" />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Priority:</span>
          {["low","normal","high","critical"].map(p => (
            <button key={p} onClick={() => setPriority(p)} style={btn(p === priority, PRIORITY_COLOURS[p])}>{p}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>Assignee (optional)</label>
          <input value={assignee} onChange={(e: any) => setAssignee(e.target.value)} style={inp()} placeholder="operator@unit" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#94a3b8" }}>Source event ID (optional)</label>
          <input value={sourceEventId} onChange={(e: any) => setSourceEventId(e.target.value)} style={inp()} placeholder="Persisted event id to anchor this task" />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btn()}>Cancel</button>
          <button onClick={submit} disabled={busy || !title.trim()} style={{ ...btn(true), opacity: busy || !title.trim() ? 0.5 : 1 }}>
            {busy ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Task detail panel ────────────────────────────────────────────────────────
function TaskDetail({ task, onUpdated, onClose }: { task: Task; onUpdated: () => void; onClose: () => void }) {
  const [detail, setDetail] = useState<(Task & { audit_trail: any[] }) | null>(null);
  const [reports, setReports] = useState<TaskReport[]>([]);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState(task.outcome ?? "");
  const [busy, setBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");

  useEffect(() => {
    Promise.all([getTask(task.id), listReports(task.id)])
      .then(([taskDetail, reportRows]) => {
        setDetail(taskDetail);
        setReports(reportRows.items);
      })
      .catch(() => {});
  }, [task.id]);

  async function doStatus(status: string) {
    setBusy(true);
    try {
      await patchTask(task.id, { status, actor: "operator", note: note || undefined });
      onUpdated();
      setBusy(false);
    } catch { setBusy(false); }
  }

  async function doOutcome() {
    if (!outcome.trim()) return;
    setBusy(true);
    try {
      await patchTask(task.id, { outcome: outcome.trim(), status: "closed", actor: "operator" });
      onUpdated();
      onClose();
    } catch { setBusy(false); }
  }

  async function regenerateReport() {
    setReportBusy(true);
    setReportError("");
    try {
      const report = await generateTaskReport(task.id);
      setReports((prev) => [report, ...prev.filter((item) => item.id !== report.id)]);
      onUpdated();
    } catch (e: any) {
      setReportError(e.message || String(e));
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: "#0b1024", border: "1px solid #1f2937", borderRadius: 16, padding: 24, width: 560, maxHeight: "80vh", overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15, display: "flex", justifyContent: "space-between" }}>
          <span>Task #{task.id}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20 }}>×</button>
        </div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{task.title}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.assignee && <span style={{ fontSize: 12, color: "#64748b" }}>@ {task.assignee}</span>}
        </div>
        {task.description && <div style={{ fontSize: 12, color: "#94a3b8" }}>{task.description}</div>}

        <div style={card()}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 11, opacity: 0.6 }}>INTELLIGENCE REPORTS</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                Saved assessments combine task text, ingested sources, and correlated live-stream events.
              </div>
            </div>
            <button onClick={regenerateReport} disabled={reportBusy} style={btn(true, "#38bdf8")}>
              {reportBusy ? "Generating…" : (reports.length ? "Regenerate report" : "Generate report")}
            </button>
          </div>
          {reportError && <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 8 }}>{reportError}</div>}
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {reports.map((report) => (
              <div key={report.id} style={{ border: "1px solid #1f2937", borderRadius: 10, padding: 10, background: "#050814" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{report.title}</div>
                  <button onClick={() => downloadTaskReport(report.id)} style={btn(false)}>Download</button>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  {report.threat_risk.toUpperCase()} risk • {report.related_sources_count} source match{report.related_sources_count === 1 ? "" : "es"} • {report.correlated_events_count} correlated event{report.correlated_events_count === 1 ? "" : "s"}
                </div>
                {report.summary && <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 6 }}>{report.summary}</div>}
              </div>
            ))}
            {!reports.length && (
              <div style={{ fontSize: 12, color: "#64748b" }}>
                No persisted report yet. Generate one manually or enable automatic task reports in AI Controls.
              </div>
            )}
          </div>
        </div>

        {/* Status actions */}
        {task.status !== "closed" && task.status !== "cancelled" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {task.status === "open" && <button onClick={() => doStatus("in_progress")} disabled={busy} style={btn()} >▶ In Progress</button>}
            {task.status === "in_progress" && <button onClick={() => doStatus("open")} disabled={busy} style={btn()}>⏸ Pause</button>}
            <button onClick={() => doStatus("cancelled")} disabled={busy} style={btn(false, "#64748b")}>✕ Cancel</button>
          </div>
        )}

        {/* Add note */}
        <div style={{ display: "flex", gap: 6 }}>
          <input value={note} onChange={(e: any) => setNote(e.target.value)} placeholder="Add a note…" style={{ ...inp(), flex: 1 }} />
          <button onClick={() => doStatus(task.status)} disabled={busy || !note.trim()} style={{ ...btn(false), flexShrink: 0 }}>Add note</button>
        </div>

        {/* Close with outcome */}
        {task.status !== "closed" && task.status !== "cancelled" && (
          <div style={{ display: "flex", gap: 6 }}>
            <input value={outcome} onChange={(e: any) => setOutcome(e.target.value)} placeholder="Outcome / disposition…" style={{ ...inp(), flex: 1 }} />
            <button onClick={doOutcome} disabled={busy || !outcome.trim()} style={{ ...btn(true, "#22c55e"), flexShrink: 0 }}>Close</button>
          </div>
        )}

        {/* Audit trail */}
        {detail?.audit_trail && detail.audit_trail.length > 0 && (
          <div style={card()}>
            <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 8, opacity: 0.6 }}>AUDIT TRAIL</div>
            {detail.audit_trail.map((te: any) => (
              <div key={te.id} style={{ fontSize: 11, color: "#64748b", padding: "3px 0", borderBottom: "1px solid #0f1929" }}>
                <span style={{ color: "#94a3b8" }}>{te.ts?.substring(0, 19)}</span>
                {" · "}<span style={{ color: "#e5e7eb" }}>{te.actor}</span>
                {" · "}<span style={{ color: "#38bdf8" }}>{te.action}</span>
                {te.detail && <span> — {te.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function TaskingPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("open");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await listTasks({ status: statusFilter === "all" ? undefined : statusFilter });
      setTasks(res.items);
      setTotal(res.total);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const STATUS_TAB = ["all","open","in_progress","closed","cancelled"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ ...card(), display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, fontSize: 14, flex: 1 }}>📋 Tasking</span>
        {STATUS_TAB.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} style={btn(s === statusFilter, STATUS_COLOURS[s])}>
            {s.replace("_", " ")}
          </button>
        ))}
        <button onClick={load} style={btn()}>↺</button>
        <button onClick={() => setCreating(true)} style={{ ...btn(true, "#22c55e") }}>＋ New task</button>
        <span style={{ fontSize: 11, opacity: 0.5 }}>{total} total</span>
      </div>

      {err && <div style={{ ...card("#ef4444"), color: "#fca5a5", fontSize: 12 }}>⚠ {err}</div>}

      {/* Task list */}
      {loading && <div style={{ fontSize: 12, opacity: 0.5 }}>Loading…</div>}

      {!loading && tasks.length === 0 && (
        <div style={{ ...card(), padding: 24, textAlign: "center", opacity: 0.5, fontSize: 13 }}>
          No {statusFilter !== "all" ? statusFilter : ""} tasks.
          Click <strong>＋ New task</strong> to create one from an alert or manually.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tasks.map(t => (
          <div
            key={t.id}
            onClick={() => setSelected(t)}
            style={{ ...card(), cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <StatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
              <span style={{ fontWeight: 700, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.title}
              </span>
              <span style={{ fontSize: 11, color: "#475569", flexShrink: 0 }}>#{t.id}</span>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#64748b" }}>
              {t.assignee && <span>@ {t.assignee}</span>}
              {t.source_event_id && <span>from event #{t.source_event_id}</span>}
              <span style={{ marginLeft: "auto" }}>{t.created_at?.substring(0, 19)}</span>
            </div>
            {t.description && (
              <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.description}
              </div>
            )}
          </div>
        ))}
      </div>

      {creating && <CreateModal onCreated={load} onClose={() => setCreating(false)} />}
      {selected && <TaskDetail task={selected} onUpdated={load} onClose={() => setSelected(null)} />}
    </div>
  );
}
