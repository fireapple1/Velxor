import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge } from "@xyflow/react";
import { ProcessTree } from "./components/ProcessTree";
import type { VelxorNode, VelxorNodeData, VelxorNodeState } from "./components/ProcessTree";
import { DetailPanel } from "./components/DetailPanel";
import { Timeline } from "./components/Timeline";
import type { TimelineEvent } from "./components/Timeline";
import { useVelxorWs } from "./ws/client";
import type { ConnectionState } from "./ws/client";
import type { AlertPayload, BehaviorEventV1, Verdict, WsMessage } from "./types";

const HEADER_H = 32;
const TIMELINE_H = 60;
const MAX_ALERTS = 5;
const KILLED_OUTCOMES = new Set(["killed", "terminated", "already_dead"]);
// Timeline viewport 는 30s — 2배 여유. 슬라이딩 컷 + 하드캡 1000 으로 무한 누적 차단.
const TIMELINE_CAP_MS = 60_000;
const TIMELINE_CAP_N = 1000;

function appendTimelineCapped(es: TimelineEvent[], evt: TimelineEvent): TimelineEvent[] {
  const next = [...es, evt];
  if (next.length <= TIMELINE_CAP_N && next[0].ts >= Date.now() - TIMELINE_CAP_MS) return next;
  const cutoff = Date.now() - TIMELINE_CAP_MS;
  return next.filter((e) => e.ts >= cutoff).slice(-TIMELINE_CAP_N);
}

type AlertEntry = AlertPayload & { ts: number; seq: number };

export default function App() {
  const [nodes, setNodes] = useState<VelxorNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedPid, setSelectedPid] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);

  // killedPids: 차단 결과로 굳어진 pid 집합 (참조용 — node.data.state 가 진실원)
  const killedPidsRef = useRef<Set<number>>(new Set());

  const handleMessage = useCallback((m: WsMessage) => {
    if (m.type === "node_add") {
      const payload = m.payload as BehaviorEventV1;
      const pid = payload.pid;
      if (pid === undefined || pid === null) return;
      const id = String(pid);
      setNodes((ns) => {
        if (ns.some((n) => n.id === id)) return ns;
        const data: VelxorNodeData = {
          ...payload,
          label: `pid ${pid}`,
          state: "normal",
        };
        const next: VelxorNode = {
          id,
          type: "velxor",
          data,
          position: { x: 0, y: 0 },
        };
        return [...ns, next];
      });
      setTimelineEvents((es) => appendTimelineCapped(es, { ts: payload.ts_unix_ms, type: "node_add" }));
    } else if (m.type === "node_update") {
      const { pid, fields } = m.payload;
      setNodes((ns) =>
        ns.map((n) =>
          n.id === String(pid)
            ? {
                ...n,
                // 스프레드 순서: state/label/pid 는 보존
                data: { ...n.data, ...fields, state: n.data.state, label: n.data.label, pid: n.data.pid },
              }
            : n,
        ),
      );
    } else if (m.type === "verdict") {
      const v = m.payload;
      setVerdict(v);
      setTimelineEvents((es) => appendTimelineCapped(es, { ts: Date.now(), type: "verdict", verdict: v.verdict }));
      if (v.verdict === "ransomware") {
        setNodes((ns) =>
          ns.map((n) => {
            if (n.id !== String(v.pid)) return n;
            // killed 가 된 노드는 dead state 유지
            if (n.data.state === "killed") return n;
            return { ...n, data: { ...n.data, state: "threat" as VelxorNodeState } };
          }),
        );
      }
    } else if (m.type === "alert") {
      const entry: AlertEntry = { ...m.payload, ts: Date.now(), seq: m.seq };
      setAlerts((as) => [...as, entry].slice(-MAX_ALERTS));
    } else if (m.type === "gap") {
      setNodes([]);
      setEdges([]);
      setVerdict(null);
      setSelectedPid(null);
      setTimelineEvents([]);
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
  }, []);

  useVelxorWs(handleMessage, setConnectionState);

  // Timeline width 가 mount 시 캡처되지 않도록 리사이즈 추적 (Electron 화면 리사이즈/외부모니터 대응)
  const [winW, setWinW] = useState<number>(() => (typeof window !== "undefined" ? window.innerWidth : 1280));
  useEffect(() => {
    const on = () => setWinW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const handleBlocked = useCallback((pid: number, outcome: string) => {
    if (KILLED_OUTCOMES.has(outcome)) {
      killedPidsRef.current.add(pid);
      setNodes((ns) =>
        ns.map((n) =>
          n.id === String(pid)
            ? { ...n, data: { ...n.data, state: "killed" as VelxorNodeState } }
            : n,
        ),
      );
    }
    setAlerts((as) =>
      [
        ...as,
        {
          pid,
          severity: "info" as const,
          message: `block(${pid}) -> ${outcome}`,
          ts: Date.now(),
          seq: -1,
        },
      ].slice(-MAX_ALERTS),
    );
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedPid) ?? null,
    [nodes, selectedPid],
  );

  const verdictForSelected = useMemo(() => {
    if (!verdict || !selectedNode) return null;
    return verdict.pid === Number(selectedNode.id) ? verdict : null;
  }, [verdict, selectedNode]);

  const showPanel = selectedNode !== null;

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        background: "#0a0a0c",
      }}
    >
      <Header connection={connectionState} alerts={alerts} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 3, minWidth: 0 }}>
          <ProcessTree
            nodes={nodes}
            edges={edges}
            onSelect={(n) => setSelectedPid(n.id)}
          />
        </div>
        {showPanel && (
          <div style={{ flex: 1, minWidth: 320, maxWidth: 480 }}>
            <DetailPanel node={selectedNode} verdict={verdictForSelected} onBlocked={handleBlocked} />
          </div>
        )}
      </div>
      <div style={{ height: TIMELINE_H, flexShrink: 0 }}>
        <Timeline events={timelineEvents} width={winW} height={TIMELINE_H} />
      </div>
    </div>
  );
}

function Header({ connection, alerts }: { connection: ConnectionState; alerts: AlertEntry[] }) {
  const dotColor =
    connection === "connected" ? "#00ff66" : connection === "connecting" ? "#ffcc00" : "#ff3333";

  return (
    <div
      style={{
        height: HEADER_H,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        background: "#0a0a0c",
        borderBottom: "1px solid #00ffcc33",
      }}
    >
      <div style={{ color: "#00ffcc", fontWeight: 700, letterSpacing: 2 }}>VELXOR</div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <AlertStrip alerts={alerts} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: dotColor,
              boxShadow: `0 0 6px ${dotColor}`,
              display: "inline-block",
            }}
          />
          <span style={{ color: "#00ffcc99", fontSize: 11 }}>{connection}</span>
        </div>
      </div>
    </div>
  );
}

function AlertStrip({ alerts }: { alerts: AlertEntry[] }) {
  if (alerts.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ display: "flex", gap: 6, maxWidth: "min(60vw, 800px)", overflow: "hidden" }}
    >
      {alerts.map((a) => (
        <div
          key={`${a.seq}-${a.ts}-${a.pid}`}
          title={a.message}
          style={{
            fontSize: 10,
            color:
              a.severity === "error" ? "#ff3333" : a.severity === "warn" ? "#ffcc00" : "#00ffcc99",
            border: `1px solid ${a.severity === "error" ? "#ff333355" : a.severity === "warn" ? "#ffcc0055" : "#00ffcc33"}`,
            padding: "2px 6px",
            borderRadius: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 180,
          }}
        >
          [{a.severity}] {a.message}
        </div>
      ))}
    </div>
  );
}
