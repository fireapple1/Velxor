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
  BehaviorEventV1,
  Verdict,
  WsMessage,
} from "./types";

const TIMELINE_H = 72;

const MAX_ALERTS = 5;

const KILLED_OUTCOMES = new Set([
  "killed",
  "terminated",
  "already_dead",
]);

const TIMELINE_CAP_MS = 60_000;
const TIMELINE_CAP_N = 1000;

function appendTimelineCapped(
  es: TimelineEvent[],
  evt: TimelineEvent,
): TimelineEvent[] {
  const next = [...es, evt];

  if (
    next.length <= TIMELINE_CAP_N &&
    next[0].ts >= Date.now() - TIMELINE_CAP_MS
  ) {
    return next;
  }

  const cutoff = Date.now() - TIMELINE_CAP_MS;

  return next
    .filter((e) => e.ts >= cutoff)
    .slice(-TIMELINE_CAP_N);
}

type AlertEntry = AlertPayload & {
  ts: number;
  seq: number;
};

export default function App() {
  const [nodes, setNodes] = useState<VelxorNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [selectedPid, setSelectedPid] =
    useState<string | null>(null);

  const [verdict, setVerdict] =
    useState<Verdict | null>(null);

  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");

  const [alerts, setAlerts] = useState<AlertEntry[]>([]);

  const [timelineEvents, setTimelineEvents] =
    useState<TimelineEvent[]>([]);

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

      setTimelineEvents((es) =>
        appendTimelineCapped(es, {
          ts: payload.ts_unix_ms,
          type: "node_add",
        }),
      );
    }

    else if (m.type === "node_update") {
      const { pid, fields } = m.payload;

      setNodes((ns) =>
        ns.map((n) =>
          n.id === String(pid)
            ? {
                ...n,
                data: {
                  ...n.data,
                  ...fields,
                  state: n.data.state,
                  label: n.data.label,
                  pid: n.data.pid,
                },
              }
            : n,
        ),
      );
    }

    else if (m.type === "verdict") {
      const v = m.payload;

      setVerdict(v);

      setTimelineEvents((es) =>
        appendTimelineCapped(es, {
          ts: Date.now(),
          type: "verdict",
          verdict: v.verdict,
        }),
      );

      if (v.verdict === "ransomware") {
        setNodes((ns) =>
          ns.map((n) => {
            if (n.id !== String(v.pid)) return n;

            if (n.data.state === "killed") return n;

            return {
              ...n,
              data: {
                ...n.data,
                state: "threat" as VelxorNodeState,
              },
            };
          }),
        );
      }
    }

    else if (m.type === "alert") {
      const entry: AlertEntry = {
        ...m.payload,
        ts: Date.now(),
        seq: m.seq,
      };

      setAlerts((as) =>
        [...as, entry].slice(-MAX_ALERTS),
      );
    }

    else if (m.type === "gap") {
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

      setAlerts((as) =>
        [...as, gapAlert].slice(-MAX_ALERTS),
      );
    }
  }, []);

  useVelxorWs(handleMessage, setConnectionState);

  const [winW, setWinW] = useState<number>(() =>
    typeof window !== "undefined"
      ? window.innerWidth
      : 1280,
  );

  useEffect(() => {
    const on = () => setWinW(window.innerWidth);

    window.addEventListener("resize", on);

    return () =>
      window.removeEventListener("resize", on);
  }, []);

  const handleBlocked = useCallback(
    (pid: number, outcome: string) => {
      if (KILLED_OUTCOMES.has(outcome)) {
        killedPidsRef.current.add(pid);

        setNodes((ns) =>
          ns.map((n) =>
            n.id === String(pid)
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    state: "killed" as VelxorNodeState,
                  },
                }
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
            message: `block(${pid}) → ${outcome}`,
            ts: Date.now(),
            seq: -1,
          },
        ].slice(-MAX_ALERTS),
      );
    },
    [],
  );

  const selectedNode = useMemo(
    () =>
      nodes.find((n) => n.id === selectedPid) ?? null,
    [nodes, selectedPid],
  );

  const verdictForSelected = useMemo(() => {
    if (!verdict || !selectedNode) return null;

    return verdict.pid === Number(selectedNode.id)
      ? verdict
      : null;
  }, [verdict, selectedNode]);

  const showPanel = selectedNode !== null;

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",

        display: "flex",
        flexDirection: "column",

        background: "#0B0F14",

        color: "#E6EDF3",
      }}
    >
      <Header
        connection={connectionState}
        alerts={alerts}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
        }}
      >
        <Sidebar />

        <div
          style={{
            flex: 1,
            display: "flex",
            minWidth: 0,
          }}
        >
          <div
            style={{
              flex: 3,
              minWidth: 0,
            }}
          >
            <ProcessTree
              nodes={nodes}
              edges={edges}
              onSelect={(n) =>
                setSelectedPid(n.id)
              }
            />
          </div>

          {showPanel && (
            <div
              style={{
                width: 380,

                borderLeft:
                  "1px solid #1E2936",

                background: "#0F141B",
              }}
            >
              <DetailPanel
                node={selectedNode}
                verdict={verdictForSelected}
                onBlocked={handleBlocked}
              />
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          height: TIMELINE_H,
          flexShrink: 0,
        }}
      >
        <Timeline
          events={timelineEvents}
          width={winW}
          height={TIMELINE_H}
        />
      </div>
    </div>
  );
}

function Header({
  connection,
  alerts,
}: {
  connection: ConnectionState;
  alerts: AlertEntry[];
}) {
  const dotColor =
    connection === "connected"
      ? "#3FB950"
      : connection === "connecting"
      ? "#D29922"
      : "#FF4D4F";

  return (
    <div
      style={{
        height: 52,

        flexShrink: 0,

        display: "flex",

        alignItems: "center",

        justifyContent: "space-between",

        padding: "0 20px",

        borderBottom: "1px solid #1E2936",

        background: "rgba(11,15,20,0.92)",

        backdropFilter: "blur(14px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,

            borderRadius: 999,

            background: "#00C2FF",
          }}
        />

        <div
          style={{
            color: "#E6EDF3",

            fontSize: 18,

            fontWeight: 700,

            letterSpacing: 1.2,
          }}
        >
          VELXOR
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <AlertStrip alerts={alerts} />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,

            padding: "6px 10px",

            borderRadius: 999,

            background: "#121821",

            border: "1px solid #1E2936",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,

              borderRadius: 999,

              background: dotColor,

              display: "inline-block",
            }}
          />

          <span
            style={{
              color: "#8B949E",

              fontSize: 11,

              fontWeight: 600,

              textTransform: "uppercase",
            }}
          >
            {connection}
          </span>
        </div>
      </div>
    </div>
  );
}

function AlertStrip({
  alerts,
}: {
  alerts: AlertEntry[];
}) {
  if (alerts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        gap: 8,

        maxWidth: "min(60vw, 800px)",

        overflow: "hidden",
      }}
    >
      {alerts.map((a) => (
        <div
          key={`${a.seq}-${a.ts}-${a.pid}`}
          title={a.message}
          style={{
            fontSize: 11,

            fontWeight: 600,

            color:
              a.severity === "error"
                ? "#FF7B72"
                : a.severity === "warn"
                ? "#D29922"
                : "#79C0FF",

            background:
              a.severity === "error"
                ? "rgba(255,77,79,0.12)"
                : a.severity === "warn"
                ? "rgba(210,153,34,0.12)"
                : "rgba(0,194,255,0.08)",

            border: `1px solid ${
              a.severity === "error"
                ? "rgba(255,77,79,0.25)"
                : a.severity === "warn"
                ? "rgba(210,153,34,0.25)"
                : "rgba(0,194,255,0.18)"
            }`,

            padding: "7px 12px",

            borderRadius: 999,

            whiteSpace: "nowrap",

            overflow: "hidden",

            textOverflow: "ellipsis",

            maxWidth: 220,
          }}
        >
          [{a.severity}] {a.message}
        </div>
      ))}
    </div>
  );
}