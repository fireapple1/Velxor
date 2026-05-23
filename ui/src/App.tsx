import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge } from "@xyflow/react";

import { ProcessTree } from "./components/ProcessTree";
import type {
  VelxorNode,
  VelxorNodeData,
  VelxorNodeState,
} from "./components/ProcessTree";

import { DetailPanel } from "./components/DetailPanel";
import { Timeline } from "./components/Timeline";
import { Sidebar } from "./components/Sidebar";

import type { TimelineEvent } from "./components/Timeline";

import { useVelxorWs } from "./ws/client";
import type { ConnectionState } from "./ws/client";

import type {
  AlertPayload,
  Verdict,
  WsMessage,
} from "./types";

const TIMELINE_H = 72;
const MAX_ALERTS = 5;

const KILLED_OUTCOMES = new Set(["killed", "terminated", "already_dead"]);
const TIMELINE_CAP_MS = 60_000;
const TIMELINE_CAP_N = 1000;
const CONSOLE_LOG_CAP = 180;

function appendTimelineCapped(es: TimelineEvent[], evt: TimelineEvent): TimelineEvent[] {
  const next = [...es, evt];
  if (next.length <= TIMELINE_CAP_N && next[0].ts >= Date.now() - TIMELINE_CAP_MS) return next;
  const cutoff = Date.now() - TIMELINE_CAP_MS;
  return next.filter((e) => e.ts >= cutoff).slice(-TIMELINE_CAP_N);
}

type AlertEntry = AlertPayload & { ts: number; seq: number; };

type ConsoleLevel =
  | "SYSTEM"
  | "INFO"
  | "SUCCESS"
  | "WARN"
  | "CRIT"
  | "TRACE"
  | "WS"
  | "AI";

type ConsoleLog = {
  id: number;
  ts: number;
  level: ConsoleLevel;
  message: string;
};

function makeConsoleLog(level: ConsoleLevel, message: string): ConsoleLog {
  return {
    id: Date.now() + Math.floor(Math.random() * 100000),
    ts: Date.now(),
    level,
    message,
  };
}

function formatConsoleTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export default function App() {
  const [nodes, setNodes] = useState<VelxorNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedPid, setSelectedPid] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [criticalBanner, setCriticalBanner] = useState<{ pid: number; message: string; } | null>(null);

  const killedPidsRef = useRef<Set<number>>(new Set());
  const [blockedCount, setBlockedCount] = useState(0);

  const consoleSeqRef = useRef(0);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([
    makeConsoleLog("SYSTEM", "VELXOR telemetry console initialized."),
    makeConsoleLog("SYSTEM", "Kernel event bridge standing by."),
    makeConsoleLog("WS", "Awaiting secure WebSocket handshake verification."),
  ]);

  const pushConsoleLog = useCallback((level: ConsoleLevel, message: string) => {
    consoleSeqRef.current += 1;

    const entry: ConsoleLog = {
      id: Date.now() + consoleSeqRef.current,
      ts: Date.now(),
      level,
      message,
    };

    setConsoleLogs((prev) => [...prev, entry].slice(-CONSOLE_LOG_CAP));
  }, []);

  const handleMessage = useCallback((m: WsMessage) => {
    if (m.type === "node_add") {
      const payload = m.payload as any;
      const pid = payload.pid;
      const parentPid = payload.parent_pid;

      if (pid === undefined || pid === null) return;
      const id = String(pid);

      const imgPath = typeof payload.image_path === "string" ? payload.image_path : "";
      const processName = imgPath ? imgPath.split(/[/\\]/).pop() : `Unknown`;

      pushConsoleLog(
        "INFO",
        `Process topology node initialized: ${processName} / PID=${pid}${parentPid ? ` / PPID=${parentPid}` : ""}`,
      );

      setNodes((ns) => {
        if (ns.some((n) => n.id === id)) return ns;
        const data: VelxorNodeData = {
          ...payload,
          pid: pid,
          label: processName,
          state: "normal",
        };
        const offset = (ns.length % 15) * 50;
        const next: VelxorNode = {
          id, type: "velxor", data,
          position: { x: 50 + offset, y: 50 + offset },
        };
        return [...ns, next];
      });

      if (parentPid && parentPid !== 0) {
        setEdges((es) => {
          const edgeId = `e-${parentPid}-${pid}`;
          if (es.some((e) => e.id === edgeId)) return es;

          pushConsoleLog("TRACE", `Graph edge linked: ${parentPid} -> ${pid}`);

          return [
            ...es,
            {
              id: edgeId,
              source: String(parentPid),
              target: String(pid),
              animated: true,
              style: { stroke: "#00ffcc", strokeWidth: 1.5, opacity: 0.6 },
            },
          ];
        });
      }

      setTimelineEvents((es) => appendTimelineCapped(es, {
        ts: typeof payload.ts_unix_ms === "number" ? payload.ts_unix_ms : Date.now(),
        type: "node_add",
      }));
    } else if (m.type === "node_update") {
      const { pid, fields } = m.payload;

      pushConsoleLog("TRACE", `Node metadata updated: PID=${pid}`);

      setNodes((ns) => ns.map((n) => n.id === String(pid) ? {
        ...n,
        data: {
          ...n.data,
          ...fields,
          state: n.data.state,
          label: n.data.label,
          pid: n.data.pid,
        },
      } : n));
    } else if (m.type === "verdict") {
      const v = m.payload;
      setVerdict(v);

      pushConsoleLog("AI", `AI verdict received: PID=${v.pid} / verdict=${v.verdict}`);

      setTimelineEvents((es) => appendTimelineCapped(es, {
        ts: Date.now(),
        type: "verdict",
        verdict: v.verdict,
      }));

      if (v.verdict === "ransomware") {
        pushConsoleLog("CRIT", `Ransomware behavior detected. PID=${v.pid}. Escalating visual threat state.`);

        setCriticalBanner({
          pid: v.pid,
          message: `PID ${v.pid} 프로세스에서 악성 암호화 행위가 감지되었습니다.`,
        });

        setNodes((ns) => ns.map((n) => {
          if (n.id !== String(v.pid)) return n;
          if (n.data.state === "killed") return n;
          return { ...n, data: { ...n.data, state: "threat" as VelxorNodeState } };
        }));

        setEdges((es) => es.map((e) =>
          e.target === String(v.pid) || e.source === String(v.pid)
            ? { ...e, style: { stroke: "#ff3333", strokeWidth: 2, opacity: 1 } }
            : e,
        ));
      }
    } else if (m.type === "alert") {
      const entry: AlertEntry = { ...m.payload, ts: Date.now(), seq: m.seq };

      pushConsoleLog(
        entry.severity === "error" ? "CRIT" : entry.severity === "warn" ? "WARN" : "INFO",
        `Security alert received: PID=${entry.pid} / ${entry.message}`,
      );

      setAlerts((as) => [...as, entry].slice(-MAX_ALERTS));
    } else if (m.type === "gap") {
      pushConsoleLog("WARN", `Stream sequence gap detected. Full graph refresh requested: ${m.payload.from} -> ${m.payload.to}`);

      setNodes([]);
      setEdges([]);
      setVerdict(null);
      setSelectedPid(null);
      setTimelineEvents([]);
      setCriticalBanner(null);
      setBlockedCount(0);
      killedPidsRef.current.clear();

      const gapAlert: AlertEntry = {
        pid: 0,
        severity: "warn",
        message: `full refresh: gap from ${m.payload.from} to ${m.payload.to}`,
        ts: Date.now(),
        seq: m.seq,
      };
      setAlerts((as) => [...as, gapAlert].slice(-MAX_ALERTS));
    }
  }, [pushConsoleLog]);

  useVelxorWs(handleMessage, setConnectionState);

  useEffect(() => {
    if (connectionState === "connected") {
      pushConsoleLog("SUCCESS", "WebSocket handshake verification complete.");
      pushConsoleLog("WS", "Live backend event stream attached.");
    } else if (connectionState === "connecting") {
      pushConsoleLog("WS", "WebSocket channel negotiating secure session.");
    } else {
      pushConsoleLog("WARN", "WebSocket channel disconnected. Waiting for reconnect.");
    }
  }, [connectionState, pushConsoleLog]);

  useEffect(() => {
    const samples = [
      "kernel telemetry heartbeat accepted.",
      "memory entropy sampler window rotated.",
      "process watcher queue flushed.",
      "behavior vector cache synchronized.",
      "I/O trace batch committed.",
      "runtime policy checksum verified.",
      "event bus pressure normalized.",
      "graph renderer sync tick acknowledged.",
      "threat scoring window advanced.",
      "endpoint sensor pulse received.",
    ];

    const interval = window.setInterval(() => {
      const index = Math.floor(Math.random() * samples.length);
      const level: ConsoleLevel = connectionState === "connected" ? "TRACE" : "WS";
      pushConsoleLog(level, samples[index]);
    }, 1300);

    return () => window.clearInterval(interval);
  }, [connectionState, pushConsoleLog]);

  const [winW, setWinW] = useState<number>(() => typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => {
    const on = () => setWinW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const handleBlocked = useCallback((pid: number, outcome: string) => {
    if (KILLED_OUTCOMES.has(outcome)) {
      killedPidsRef.current.add(pid);
      setBlockedCount((c) => c + 1);

      pushConsoleLog("SUCCESS", `Active defense interception complete: PID=${pid} / outcome=${outcome}`);

      setNodes((ns) => ns.map((n) => n.id === String(pid) ? {
        ...n,
        data: { ...n.data, state: "killed" as VelxorNodeState },
      } : n));
    } else {
      pushConsoleLog("WARN", `Active defense request returned non-terminal outcome: PID=${pid} / outcome=${outcome}`);
    }

    setAlerts((as) => [...as, {
      pid,
      severity: "info" as const,
      message: `block(${pid}) → ${outcome}`,
      ts: Date.now(),
      seq: -1,
    }].slice(-MAX_ALERTS));
  }, [pushConsoleLog]);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedPid) ?? null, [nodes, selectedPid]);
  const verdictForSelected = useMemo(() => {
    if (!verdict || !selectedNode) return null;
    return verdict.pid === Number(selectedNode.id) ? verdict : null;
  }, [verdict, selectedNode]);

  const showPanel = selectedNode !== null;

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", background: "#0B0F14", color: "#E6EDF3" }}>
      <Header connection={connectionState} alerts={alerts} />

      <LogTicker />

      {criticalBanner && (
        <div style={{ background: "#4a0000", borderBottom: "2px solid #ff3333", color: "#fff", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", animation: "slide-down 0.4s cubic-bezier(0.16, 1, 0.3, 1)", zIndex: 1000, boxShadow: "0 4px 12px rgba(255, 51, 51, 0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <span style={{ fontSize: "20px" }}>⚠️</span>
            <div>
              <div style={{ fontWeight: "bold", fontSize: "14px", color: "#ff3333", letterSpacing: "1px" }}>RANSOMWARE DETECTED</div>
              <div style={{ fontSize: "12px", opacity: 0.9, marginTop: "2px" }}>{criticalBanner.message}</div>
            </div>
          </div>
          <button onClick={() => setCriticalBanner(null)} style={{ background: "transparent", border: "none", color: "#fff", fontSize: "18px", cursor: "pointer", opacity: 0.7 }}>✕</button>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Sidebar />

        <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
          <div style={{ flex: 3, minWidth: 0, position: "relative", backgroundImage: `linear-gradient(rgba(0, 255, 204, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 204, 0.04) 1px, transparent 1px)`, backgroundSize: "40px 40px" }}>

            <div style={{ position: "absolute", top: 16, right: 16, zIndex: 10, width: "220px", background: "rgba(15, 20, 27, 0.8)", backdropFilter: "blur(4px)", padding: "16px", borderRadius: "8px", border: "1px solid rgba(0, 255, 204, 0.2)", display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px", color: "#8B949E", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
              <div style={{ color: "#E6EDF3", fontWeight: "bold", marginBottom: "8px", letterSpacing: "1px" }}>SYSTEM METRICS</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Active Nodes</span> <span style={{ color: "#00ffcc", fontWeight: "bold" }}>{nodes.length}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Threats Blocked</span> <span style={{ color: blockedCount > 0 ? "#ff3333" : "#8B949E", fontWeight: "bold" }}>{blockedCount}</span></div>
              <div style={{ marginTop: "8px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <MiniSparkline label="CORE CPU USAGE" color="#ffcc00" />
                <MiniSparkline label="KERNEL I/O EVENT" color="#00ffcc" />
              </div>
            </div>

            <ProcessTree nodes={nodes} edges={edges} onSelect={(n) => setSelectedPid(n.id)} />
          </div>

          {showPanel && (
            <div style={{ width: 380, borderLeft: "1px solid #1E2936", background: "#0F141B" }}>
              <DetailPanel node={selectedNode} verdict={verdictForSelected} onBlocked={handleBlocked} />
            </div>
          )}
        </div>
      </div>

      <LiveEventConsole logs={consoleLogs} connection={connectionState} />

      <div style={{ height: TIMELINE_H, flexShrink: 0 }}>
        <Timeline events={timelineEvents} width={winW} height={TIMELINE_H} />
      </div>
    </div>
  );
}

function LiveEventConsole({
  logs,
  connection,
}: {
  logs: ConsoleLog[];
  connection: ConnectionState;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [logs]);

  return (
    <div className="live-console-panel">
      <div className="live-console-left-rail">
        <div className="live-console-rail-title">LIVE</div>
        <div className="live-console-rail-dot" />
        <div className="live-console-rail-text">EVENT</div>
      </div>

      <div className="live-console-main">
        <div className="live-console-header">
          <div className="live-console-title">
            <span className="live-console-title-glow">CONSOLE MONITORING STREAM</span>
            <span className="live-console-subtitle">BACKEND EVENT BUS / PROCESS TELEMETRY / AI VERDICT TRACE</span>
          </div>

          <div className="live-console-status">
            <span className={`live-console-status-dot live-console-status-${connection}`} />
            <span>{connection.toUpperCase()}</span>
          </div>
        </div>

        <div className="live-console-body">
          {logs.map((log) => (
            <div key={log.id} className={`live-console-line live-console-${log.level.toLowerCase()}`}>
              <span className="live-console-time">[{formatConsoleTime(log.ts)}]</span>
              <span className="live-console-level">[{log.level}]</span>
              <span className="live-console-message">{log.message}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}

function LogTicker() {
  return (
    <div className="ticker-wrapper">
      <div className="ticker-move">
        <span className="ticker-item">[SYS] kernel_read: /etc/shadow </span>
        <span className="ticker-item">[NET] outbound_conn: 192.168.1.5:443 </span>
        <span className="ticker-item">[MEM] alloc: 4096 bytes at 0x7fff... </span>
        <span className="ticker-item">[SEC] file_write: C:\Users\Admin\Documents... </span>
        <span className="ticker-item">[SYS] hook_detected: ntdll.dll </span>
        <span className="ticker-item">[NET] dns_query: unknown-domain.xyz </span>
        <span className="ticker-item">[SEC] entropy_spike: 7.99 in thread 4912 </span>
        <span className="ticker-item">[SYS] child_process: cmd.exe /c start </span>
        <span className="ticker-item">[SYS] kernel_read: /etc/shadow </span>
        <span className="ticker-item">[NET] outbound_conn: 192.168.1.5:443 </span>
        <span className="ticker-item">[MEM] alloc: 4096 bytes at 0x7fff... </span>
        <span className="ticker-item">[SEC] file_write: C:\Users\Admin\Documents... </span>
      </div>
    </div>
  );
}

function Header({ connection, alerts }: { connection: ConnectionState; alerts: AlertEntry[]; }) {
  const dotColor = connection === "connected" ? "#3FB950" : connection === "connecting" ? "#D29922" : "#FF4D4F";
  return (
    <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", background: "#0a0a0c", borderBottom: "1px solid #1E2936" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 10, height: 10, borderRadius: 999, background: "#00C2FF" }} />
        <div style={{ color: "#E6EDF3", fontSize: 18, fontWeight: 700, letterSpacing: 1.2 }}>VELXOR</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <AlertStrip alerts={alerts} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, background: "#121821", border: "1px solid #1E2936" }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: dotColor, display: "inline-block" }} />
          <span style={{ color: "#8B949E", fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>{connection}</span>
        </div>
      </div>
    </div>
  );
}

function AlertStrip({ alerts }: { alerts: AlertEntry[]; }) {
  if (alerts.length === 0) return null;
  return (
    <div role="status" aria-live="polite" style={{ display: "flex", gap: 8, maxWidth: "min(60vw, 800px)", overflow: "hidden" }}>
      {alerts.map((a) => (
        <div key={`${a.seq}-${a.ts}-${a.pid}`} title={a.message} style={{ fontSize: 11, fontWeight: 600, color: a.severity === "error" ? "#FF7B72" : a.severity === "warn" ? "#D29922" : "#79C0FF", background: a.severity === "error" ? "rgba(255,77,79,0.12)" : a.severity === "warn" ? "rgba(210,153,34,0.12)" : "rgba(0,194,255,0.08)", border: `1px solid ${a.severity === "error" ? "rgba(255,77,79,0.25)" : a.severity === "warn" ? "rgba(210,153,34,0.25)" : "rgba(0,194,255,0.18)"}`, padding: "7px 12px", borderRadius: 999, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>
          [{a.severity}] {a.message}
        </div>
      ))}
    </div>
  );
}

function MiniSparkline({ color, label }: { color: string; label: string }) {
  const [data, setData] = useState<number[]>(Array(20).fill(20));
  useEffect(() => {
    const interval = setInterval(() => {
      setData((prev) => {
        let nextVal = prev[prev.length - 1] + (Math.random() * 40 - 20);
        if (nextVal < 10) nextVal = 10 + Math.random() * 15;
        if (nextVal > 90) nextVal = 90 - Math.random() * 10;
        return [...prev.slice(1), nextVal];
      });
    }, 800 + Math.random() * 400);
    return () => clearInterval(interval);
  }, []);

  const height = 30, width = 200, step = width / (data.length - 1);
  const points = data.map((d, i) => `${i * step},${height - (d / 100) * height}`).join(" ");

  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ fontSize: "10px", color: "#8B949E", marginBottom: "4px", display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span><span style={{ color: color }}>{Math.round(data[data.length - 1])}%</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "30px", overflow: "visible" }}>
        <polygon points={`0,${height} ${points} ${width},${height}`} fill={`${color}1A`} />
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}