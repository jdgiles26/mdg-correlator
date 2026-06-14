import React, { useEffect, useMemo, useState } from "react";
import { Activity, Video, Rss, Upload, Radio, RefreshCw, Power, Plus, Link2, LayoutGrid, Search, Network, ClipboardList } from "lucide-react";
import {
  addFeed,
  downloadTaskReport,
  eventsWsUrl,
  getAIBrief,
  getAISettings,
  getSystemStatus,
  ingestUrl,
  listEvents,
  listReports,
  listFeeds,
  toggleFeed,
  updateAISettings,
  uploadFile,
  type AISettings,
  type Feed,
  type MissionEvent,
  type OllamaStatus,
  type SystemStatus,
  type TaskReport,
} from "./api";
import { HlsPlayer } from "./components/HlsPlayer";
import { MultiGrid } from "./components/MultiGrid";
import { DjiLivePanel } from "./components/DjiLivePanel";
import { GraphExplorer } from "./components/GraphExplorer";
import { SemanticSearch } from "./components/SemanticSearch";
import { TaskingPanel } from "./components/TaskingPanel";
import { AIControlsPanel } from "./components/AIControlsPanel";

type BusMsg = MissionEvent;

export default function App() {
  const [tab, setTab] = useState<"Dashboard"|"Multigrid"|"DJI Live"|"Feeds"|"Ingest"|"OSINT/Events"|"Graph"|"Search"|"Tasks">("Multigrid");
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [events, setEvents] = useState<BusMsg[]>([]);
  const [err, setErr] = useState<string>("");
  const [aiSettings, setAISettings] = useState<AISettings | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [aiMessage, setAIMessage] = useState("");
  const [aiSaving, setAISaving] = useState(false);
  const [brief, setBrief] = useState<{ model: string; summary: string; events_considered: number } | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [reports, setReports] = useState<TaskReport[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);

  async function refresh() {
    setErr("");
    try {
      const [feedRows, ai, reportRows, system, recentEvents] = await Promise.all([listFeeds(), getAISettings(), listReports(), getSystemStatus(), listEvents(80)]);
      setFeeds(feedRows);
      setAISettings(ai.settings);
      setOllama(ai.ollama);
      setReports(reportRows.items);
      setSystemStatus(system);
      setEvents(recentEvents);
    } catch(e:any){ setErr(e.message || String(e)); }
  }

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      getSystemStatus().then(setSystemStatus).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(eventsWsUrl());
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as BusMsg;
        setEvents(prev => [msg, ...prev].slice(0, 250));
        if (msg.topic === "task.report.generated") {
          listReports().then((res) => setReports(res.items)).catch(() => {});
        }
      } catch {}
    };
    ws.onerror = () => {};
    return () => ws.close();
  }, []);

  const activeAlerts = useMemo(() => {
    const predictorFloor = aiSettings?.predictor_min_anomaly_score ?? 0.7;
    return events.filter((e) => {
      if (e.topic === "anomaly.cluster") return true;
      if (e.topic === "predictor.forecast" && (e.score ?? 0) >= predictorFloor) return true;
      if (e.topic === "task.alert") return true;
      return false;
    }).length;
  }, [aiSettings?.predictor_min_anomaly_score, events]);

  const missionAlerts = useMemo(() => {
    return events.filter((e) => ["anomaly.cluster", "predictor.forecast", "task.alert"].includes(e.topic)).slice(0, 8);
  }, [events]);

  async function saveAIControls() {
    if (!aiSettings) return;
    setAISaving(true);
    setAIMessage("");
    try {
      const res = await updateAISettings(aiSettings);
      setAISettings(res.settings);
      setOllama(res.ollama);
      setAIMessage("AI controls saved.");
    } catch (e: any) {
      setAIMessage(e.message || String(e));
    } finally {
      setAISaving(false);
    }
  }

  async function generateBrief() {
    setBriefBusy(true);
    setAIMessage("");
    try {
      setBrief(await getAIBrief());
    } catch (e: any) {
      setAIMessage(e.message || String(e));
    } finally {
      setBriefBusy(false);
    }
  }

  return (
    <div style={{maxWidth:1400, margin:"0 auto", padding:16}}>
      <TopBar tab={tab} setTab={setTab} onRefresh={refresh} />
      {err && <div style={card({border:"#ef4444"})}>Error: {err}</div>}
      {tab === "Dashboard" && (
        <Dashboard
          feeds={feeds}
          events={events}
          activeAlerts={activeAlerts}
          aiSettings={aiSettings}
          ollama={ollama}
          aiMessage={aiMessage}
          aiSaving={aiSaving}
          brief={brief}
          briefBusy={briefBusy}
          reports={reports}
          systemStatus={systemStatus}
          missionAlerts={missionAlerts}
          onAIChange={setAISettings}
          onAISave={saveAIControls}
          onAIRefresh={refresh}
          onGenerateBrief={generateBrief}
        />
      )}
      {tab === "Multigrid" && <MultiGrid aiSettings={aiSettings} />}
      {tab === "DJI Live" && <DjiLivePanel />}
      {tab === "Feeds" && <FeedsPanel feeds={feeds} setFeeds={setFeeds} systemStatus={systemStatus} />}
      {tab === "Ingest" && <IngestPanel />}
      {tab === "OSINT/Events" && <EventsPanel events={events} />}
      {tab === "Graph" && <GraphExplorer />}
      {tab === "Search" && <SemanticSearch />}
      {tab === "Tasks" && <TaskingPanel />}
      <div style={{opacity:.7,fontSize:12, marginTop:16}}>
        Only ingest feeds you are authorized to access and redistribute. This MVP intentionally avoids bulk-harvesting “all cameras”.
      </div>
    </div>
  );
}

function TopBar({tab,setTab,onRefresh}:{tab:string;setTab:(t:any)=>void;onRefresh:()=>void}) {
  const Btn = ({k,icon:Icon}:{k:any;icon:any}) => (
    <button onClick={()=>setTab(k)} style={pill(tab===k)}>
      <Icon size={16} style={{opacity:.9}}/> {k}
    </button>
  );
  return (
    <div style={{display:"flex", gap:12, alignItems:"center", marginBottom:12}}>
      <div style={{fontWeight:800, fontSize:16}}>Federated Mission Data Grid</div>
      <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
        <Btn k="Dashboard" icon={Activity}/>
        <Btn k="Multigrid" icon={LayoutGrid}/>
        <Btn k="DJI Live" icon={Radio}/>
        <Btn k="Feeds" icon={Video}/>
        <Btn k="Ingest" icon={Upload}/>
        <Btn k="OSINT/Events" icon={Rss}/>
        <Btn k="Graph" icon={Network}/>
        <Btn k="Search" icon={Search}/>
        <Btn k="Tasks" icon={ClipboardList}/>
      </div>
      <div style={{flex:1}} />
      <button onClick={onRefresh} style={pill(false)}><RefreshCw size={16}/> Refresh</button>
    </div>
  );
}

function Dashboard({
  feeds,
  events,
  activeAlerts,
  aiSettings,
  ollama,
  aiMessage,
  aiSaving,
  brief,
  briefBusy,
  reports,
  systemStatus,
  missionAlerts,
  onAIChange,
  onAISave,
  onAIRefresh,
  onGenerateBrief,
}:{
  feeds: Feed[];
  events: BusMsg[];
  activeAlerts: number;
  aiSettings: AISettings | null;
  ollama: OllamaStatus | null;
  aiMessage: string;
  aiSaving: boolean;
  brief: { model: string; summary: string; events_considered: number } | null;
  briefBusy: boolean;
  reports: TaskReport[];
  systemStatus: SystemStatus | null;
  missionAlerts: BusMsg[];
  onAIChange: React.Dispatch<React.SetStateAction<AISettings | null>>;
  onAISave: () => void;
  onAIRefresh: () => void;
  onGenerateBrief: () => void;
}) {
  const lastDet = events.find(e => e.topic==="video.detections");
  const dashboardEvents = useMemo(() => {
    const seenInfra = new Set<string>();
    return events.filter((event) => {
      if (!["feeds.connection_issue", "video.infer.error"].includes(event.topic)) {
        return true;
      }
      const key = [
        event.topic,
        event.payload?.name ?? event.payload?.feed ?? event.source,
        event.payload?.error ?? "",
      ].join("|");
      if (seenInfra.has(key)) return false;
      seenInfra.add(key);
      return true;
    }).slice(0, 30);
  }, [events]);
  return (
    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
      <div style={card()}>
        <div style={h2()}><Radio size={16}/> Grid health</div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginTop:8}}>
          <K label="Feeds" value={String(feeds.length)} />
          <K label="Active alerts" value={String(activeAlerts)} />
          <K label="Last detection" value={lastDet ? lastDet.source : "—"} />
        </div>
        <div style={{marginTop:10, fontSize:13, opacity:.9}}>
          Streams (NATS) → normalize → infer → publish detections → predict anomalies → tasking (next layer).
        </div>
      </div>

      <div style={card()}>
        <div style={h2()}><Video size={16}/> Live preview</div>
        {feeds.length ? (
          <div style={{marginTop:8}}>
            <div style={{fontSize:12, opacity:.8}}>HLS via MediaMTX:</div>
            <HlsPlayer hlsUrl={feeds[0].hls_url} />
            <div style={{fontSize:12, opacity:.7, marginTop:6}}>Showing: {feeds[0].name}</div>
          </div>
        ) : (
          <div style={{marginTop:8, opacity:.8}}>Add a feed to see live video.</div>
        )}
      </div>

      <div style={card()}>
        <div style={h2()}><Activity size={16}/> System readiness</div>
        <SystemStatusPanel status={systemStatus} />
      </div>

      <div style={card()}>
        <div style={h2()}><Activity size={16}/> Operational alerts</div>
        <div style={{display:"grid", gap:8, marginTop:10}}>
          {missionAlerts.map((alert, idx) => (
            <div key={`${alert.topic}-${idx}`} style={{border:"1px solid #1f2937", borderRadius:12, padding:10, background:"#070b1b"}}>
              <div style={{display:"flex", justifyContent:"space-between", gap:8, alignItems:"center"}}>
                <div style={{fontWeight:700, fontSize:12}}>{alert.topic}</div>
                <div style={{fontSize:11, color:"#fca5a5"}}>{alert.severity}</div>
              </div>
              <div style={{fontSize:12, color:"#cbd5e1", marginTop:6}}>
                {typeof alert.payload?.summary === "string" ? alert.payload.summary : JSON.stringify(alert.payload).slice(0, 180)}
              </div>
            </div>
          ))}
          {!missionAlerts.length && <div style={{marginTop:8, opacity:.8}}>No active operational alerts yet.</div>}
        </div>
      </div>

      <div style={card()}>
        <div style={h2()}><ClipboardList size={16}/> Saved reports</div>
        <div style={{display:"grid", gap:8, marginTop:10}}>
          {reports.slice(0, 5).map((report) => (
            <div key={report.id} style={{border:"1px solid #1f2937", borderRadius:12, padding:10, background:"#070b1b"}}>
              <div style={{display:"flex", justifyContent:"space-between", gap:8, alignItems:"center"}}>
                <div style={{fontWeight:700, fontSize:12}}>{report.title}</div>
                <button onClick={() => downloadTaskReport(report.id).catch(() => {})} style={pill(false)}>Download</button>
              </div>
              <div style={{fontSize:11, opacity:.7, marginTop:4}}>
                Task #{report.task_id} • {report.threat_risk.toUpperCase()} • {report.created_at?.substring(0, 19) ?? "pending"}
              </div>
              {report.summary && <div style={{fontSize:12, color:"#cbd5e1", marginTop:6}}>{report.summary}</div>}
            </div>
          ))}
          {!reports.length && <div style={{marginTop:8, opacity:.8}}>No saved task intelligence reports yet.</div>}
        </div>
      </div>

      <div style={{gridColumn:"1 / -1", ...card()}}>
        <div style={h2()}><Rss size={16}/> Recent events</div>
        <EventTable events={dashboardEvents} />
      </div>

      {aiSettings && (
        <div style={{gridColumn:"1 / -1"}}>
          <AIControlsPanel
            settings={aiSettings}
            ollama={ollama}
            busy={aiSaving}
            message={aiMessage}
            brief={brief}
            briefBusy={briefBusy}
            onChange={(next) => onAIChange(next)}
            onRefresh={onAIRefresh}
            onSave={onAISave}
            onGenerateBrief={onGenerateBrief}
          />
        </div>
      )}
    </div>
  );
}

function SystemStatusPanel({ status }: { status: SystemStatus | null }) {
  if (!status) {
    return <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>Refreshing component readiness…</div>;
  }

  const feedIssues = status.feed_issues.slice(0, 4);
  return (
    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={statusPill(status.api.ok)}>{status.api.ok ? "API online" : "API offline"}</span>
        <span style={statusPill(status.ollama.reachable)}>{status.ollama.reachable ? "Ollama connected" : "Ollama offline"}</span>
        <span style={statusPill(status.detections.ui_detection_enabled)}>{status.detections.ui_detection_enabled ? "UI detection enabled" : "UI detection disabled"}</span>
        <span style={statusPill(status.detections.background_inference_enabled)}>{status.detections.background_inference_enabled ? "Background inference enabled" : "Background inference disabled"}</span>
        <span style={statusPill(status.runtime.report_generation_ready)}>{status.runtime.report_generation_ready ? "Report generation ready" : "Report generation blocked"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <K label="High priority tasks" value={String(status.runtime.open_high_priority_tasks)} />
        <K label="Saved reports" value={String(status.runtime.saved_reports)} />
        <K label="Feed issues" value={String(status.feed_issues.length)} />
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
        Ollama model: {status.ollama.model || "not selected"}{status.ollama.error ? ` • ${status.ollama.error}` : ""}
      </div>
      {feedIssues.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {feedIssues.map((issue) => (
            <div key={`${issue.feed}-${issue.topic}`} style={{ border: "1px solid #3f1d1d", borderRadius: 12, padding: 10, background: "rgba(69,10,10,.22)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{issue.feed}</div>
                <div style={{ fontSize: 11, color: "#fca5a5" }}>{issue.topic}</div>
              </div>
              <div style={{ fontSize: 12, color: "#e5e7eb", marginTop: 4 }}>{issue.error}</div>
              {issue.hint && <div style={{ fontSize: 11, color: "#fda4af", marginTop: 4 }}>{issue.hint}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedsPanel({feeds,setFeeds,systemStatus}:{feeds:Feed[];setFeeds:(f:Feed[])=>void;systemStatus:SystemStatus | null}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Feed | null>(null);
  const [msg, setMsg] = useState("");
  const feedIssues = new Map((systemStatus?.feed_issues ?? []).map((issue) => [issue.feed, issue]));

  async function refreshLocal(){ setFeeds(await listFeeds()); }

  async function onAdd() {
    setBusy(true); setMsg("");
    try {
      if (!looksLikeDirectMedia(url.trim())) {
        throw new Error("Feeds only accepts direct RTSP, RTMP, SRT, UDP, TCP, or direct HLS/media URLs. Browser pages belong in Multigrid.");
      }
      await addFeed(name.trim(), url.trim());
      setName(""); setUrl("");
      await refreshLocal();
      setMsg("Feed added. Worker will restream + run inference.");
    } catch(e:any){ setMsg(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function onToggle(id:number){
    setBusy(true); setMsg("");
    try { await toggleFeed(id); await refreshLocal(); }
    catch(e:any){ setMsg(e.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{display:"grid", gridTemplateColumns:"1.2fr .8fr", gap:12}}>
      <div style={card()}>
        <div style={h2()}><Video size={16}/> Feeds</div>
        <div style={{ fontSize: 12, opacity: 0.78, marginTop: 8, lineHeight: 1.5 }}>
          Use this registry for direct RTSP, RTMP, SRT, UDP, TCP, or direct HLS/media URLs. Browser-playable pages and embeds belong in Multigrid slots.
        </div>
        <div style={{display:"flex", gap:8, marginTop:10, flexWrap:"wrap"}}>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="feed name (no spaces)" style={input()} />
          <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="rtsp://camera/stream or https://host/live.m3u8" style={{...input(), minWidth:420}} />
          <button disabled={busy || !name || !url} onClick={onAdd} style={pill(false)}><Plus size={16}/> Add</button>
        </div>
        {msg && <div style={{marginTop:8, opacity:.9, fontSize:13}}>{msg}</div>}

        <div style={{marginTop:12, display:"grid", gap:8}}>
          {feeds.map(f => (
            <div key={f.id} style={{...card({bg:"#070b1b"}), padding:12, cursor:"pointer"}} onClick={()=>setSel(f)}>
              <div style={{display:"flex", justifyContent:"space-between", gap:8, alignItems:"center"}}>
                <div style={{fontWeight:700}}>{f.name}</div>
                <button onClick={(e)=>{e.stopPropagation(); onToggle(f.id);}} style={pill(false)}>
                  <Power size={16}/> {f.enabled ? "Disable" : "Enable"}
                </button>
              </div>
              <div style={{fontSize:12, opacity:.75, marginTop:4}}>{f.enabled ? "enabled" : "disabled"} • HLS: {f.hls_url}</div>
              {feedIssues.get(f.name) && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#fda4af", lineHeight: 1.5 }}>
                  {feedIssues.get(f.name)?.error}
                  {feedIssues.get(f.name)?.hint ? ` • ${feedIssues.get(f.name)?.hint}` : ""}
                </div>
              )}
            </div>
          ))}
          {!feeds.length && <div style={{opacity:.8}}>No feeds yet.</div>}
        </div>
      </div>

      <div style={card()}>
        <div style={h2()}><Link2 size={16}/> Selected feed</div>
        {sel ? (
          <>
            <div style={{marginTop:8, fontWeight:700}}>{sel.name}</div>
            <div style={{fontSize:12, opacity:.75, marginTop:4}}>HLS: {sel.hls_url}</div>
            {feedIssues.get(sel.name) && (
              <div style={{ marginTop: 10, border: "1px solid #3f1d1d", borderRadius: 12, padding: 10, background: "rgba(69,10,10,.22)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#fecaca" }}>Latest feed issue</div>
                <div style={{ fontSize: 12, color: "#e5e7eb", marginTop: 4 }}>{feedIssues.get(sel.name)?.error}</div>
                {feedIssues.get(sel.name)?.hint && <div style={{ fontSize: 11, color: "#fda4af", marginTop: 4 }}>{feedIssues.get(sel.name)?.hint}</div>}
              </div>
            )}
            <div style={{marginTop:10}}>
              <HlsPlayer hlsUrl={sel.hls_url} />
            </div>
          </>
        ) : (
          <div style={{marginTop:8, opacity:.8}}>Pick a feed to preview.</div>
        )}
      </div>
    </div>
  );
}

function IngestPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");

  async function doUpload(){
    if (!file) return;
    setMsg("Uploading…");
    try { const r = await uploadFile(file); setMsg(`Uploaded: ${JSON.stringify(r)}`); }
    catch(e:any){ setMsg(e.message || String(e)); }
  }
  async function doUrl(){
    if (!url.trim()) return;
    setMsg("Fetching URL…");
    try { const r = await ingestUrl(url.trim()); setMsg(`Ingested: ${JSON.stringify(r)}`); }
    catch(e:any){ setMsg(e.message || String(e)); }
  }

  return (
    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
      <div style={card()}>
        <div style={h2()}><Upload size={16}/> Upload</div>
        <input type="file" onChange={e=>setFile(e.target.files?.[0] || null)} style={{marginTop:10}} />
        <div style={{marginTop:10}}>
          <button onClick={doUpload} disabled={!file} style={pill(false)}>Upload</button>
        </div>
        <div style={{marginTop:8, fontSize:13, opacity:.9}}>{msg}</div>
      </div>

      <div style={card()}>
        <div style={h2()}><Link2 size={16}/> URL ingest</div>
        <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com/article" style={{...input(), marginTop:10, width:"100%"}} />
        <div style={{marginTop:10}}>
          <button onClick={doUrl} disabled={!url.trim()} style={pill(false)}>Ingest URL</button>
        </div>
      </div>
    </div>
  );
}

function EventsPanel({events}:{events:BusMsg[]}) {
  return (
    <div style={card()}>
      <div style={h2()}><Rss size={16}/> OSINT + detections + predictions</div>
      <EventTable events={events} />
    </div>
  );
}

function EventTable({events}:{events:BusMsg[]}) {
  return (
    <div style={{marginTop:10, overflow:"auto", border:"1px solid #1f2937", borderRadius:12}}>
      <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
        <thead>
          <tr style={{background:"#0b1024", color:"#cbd5e1"}}>
            <th style={th()}>topic</th>
            <th style={th()}>severity</th>
            <th style={th()}>source</th>
            <th style={th()}>score</th>
            <th style={th()}>payload</th>
          </tr>
        </thead>
        <tbody>
          {events.slice(0,200).map((e, i) => (
            <tr key={i} style={{borderTop:"1px solid #1f2937"}}>
              <td style={td({fontWeight:700})}>{e.topic}</td>
              <td style={td()}>{e.severity}</td>
              <td style={td()}>{e.source}</td>
              <td style={td()}>{typeof e.score==="number" ? e.score.toFixed(2) : "—"}</td>
              <td style={td({maxWidth:700})}><code style={{opacity:.9}}>{JSON.stringify(e.payload).slice(0, 180)}{JSON.stringify(e.payload).length>180?"…":""}</code></td>
            </tr>
          ))}
          {!events.length && <tr><td style={td()} colSpan={5}>No events yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function K({label,value}:{label:string;value:string}) {
  return (
    <div style={{border:"1px solid #1f2937", borderRadius:12, padding:10, background:"#070b1b"}}>
      <div style={{fontSize:11, opacity:.7, textTransform:"uppercase"}}>{label}</div>
      <div style={{fontSize:18, fontWeight:800, marginTop:3}}>{value}</div>
    </div>
  );
}

function looksLikeDirectMedia(url: string): boolean {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    if (["rtsp:", "rtsps:", "rtmp:", "rtmps:", "srt:", "udp:", "tcp:"].includes(protocol)) {
      return true;
    }
    if (["http:", "https:"].includes(protocol)) {
      return [".m3u8", ".mp4", ".mkv", ".webm", ".mov", ".avi", ".mjpg", ".mjpeg", ".ts", ".flv"]
        .some((ext) => parsed.pathname.toLowerCase().endsWith(ext));
    }
  } catch {
    return false;
  }
  return false;
}

function card(opts?:{bg?:string;border?:string}) {
  return {
    background: opts?.bg ?? "rgba(8,12,30,.85)",
    border: `1px solid ${opts?.border ?? "#1f2937"}`,
    borderRadius: 16,
    padding: 16
  } as React.CSSProperties;
}
function h2(){
  return {display:"flex", gap:8, alignItems:"center", fontWeight:800, fontSize:14} as React.CSSProperties;
}
function pill(active:boolean){
  return {
    display:"inline-flex",
    gap:8,
    alignItems:"center",
    padding:"8px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? "#38bdf8" : "#1f2937"}`,
    background: active ? "rgba(56,189,248,.12)" : "rgba(8,12,30,.85)",
    color: "#e5e7eb",
    cursor:"pointer"
  } as React.CSSProperties;
}
function input(){
  return {
    padding:"10px 12px",
    borderRadius: 12,
    border:"1px solid #1f2937",
    background:"#050814",
    color:"#e5e7eb",
    outline:"none",
    minWidth: 220
  } as React.CSSProperties;
}
function th(){
  return {textAlign:"left", padding:"10px 12px", fontWeight:800, fontSize:11, textTransform:"uppercase"} as React.CSSProperties;
}
function td(opts?:React.CSSProperties){
  return {padding:"10px 12px", verticalAlign:"top", ...opts} as React.CSSProperties;
}

function statusPill(ok: boolean) {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    border: `1px solid ${ok ? "#16a34a" : "#ef4444"}`,
    background: ok ? "rgba(22,163,74,.15)" : "rgba(127,29,29,.22)",
    color: ok ? "#bbf7d0" : "#fecaca",
    fontSize: 12,
    fontWeight: 700,
  } as React.CSSProperties;
}
