import "@xyflow/react/dist/style.css";
import { useEffect, useState } from "react";
import { ProcessTree } from "./components/ProcessTree";
import { DetailPanel } from "./components/DetailPanel";
import { block, allow } from "./api/block";
import type { WsMessage } from "./types";

export default function App() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [verdict, setVerdict] = useState<any>(null);
  const [selectedPid, setSelectedPid] = useState<string | null>(null);

  useEffect(() => {
    let lastSeq = 0;
    let backoff = 250;
    let alive = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!alive) return;
      ws = new WebSocket(`ws://127.0.0.1:7000?last_seq=${lastSeq}`);

      ws.onopen = () => { backoff = 250; };

      ws.onmessage = (e) => {
        const m: WsMessage = JSON.parse(e.data);
        if (m.seq <= lastSeq) return;          // dedupe
        lastSeq = m.seq;

        if (m.type === "node_add") {
          const pid = m.payload.pid;
          if (pid === undefined || pid === null) {
            console.warn("[Velxor] node_add missing pid", m.payload);
            return;
          }
          const id = String(pid);
          setNodes((ns) => ns.some(n => n.id === id) ? ns : [...ns, {
            id,
            data: { label: `pid ${pid}`, ...m.payload },
            position: { x: 0, y: 0 },
            style: { background: "#888" },
          }]);
        } else if (m.type === "node_update") {
          setNodes((ns) => ns.map(n =>
            n.id === String(m.payload.pid)
              ? { ...n, data: { ...n.data, ...m.payload.fields } }
              : n
          ));
        } else if (m.type === "verdict") {
          setVerdict(m.payload);
          if (m.payload?.verdict === "ransomware") {
            setNodes((ns) => ns.map(n =>
              n.id === String(m.payload.pid)
                ? { ...n, style: { background: "#e53935", animation: "pulse 0.5s infinite" } }
                : n
            ));
          }
        } else if (m.type === "alert") {
          console.warn("[Velxor alert]", m.payload);
        } else if (m.type === "gap") {
          // 5초 replay 윈도우 외 → full refresh
          setNodes([]); setEdges([]); setVerdict(null); setSelectedPid(null); lastSeq = 0;
        }
      };

      ws.onclose = () => {
        if (!alive) return;
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 5000);
      };
      ws.onerror = () => { ws?.close(); };
    };

    connect();

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const selectedNode = nodes.find(n => n.id === selectedPid) ?? null;

  return (
    <div style={{ height: "100vh", display: "flex" }}>
      <div style={{ flex: 3 }}>
        <ProcessTree nodes={nodes} edges={edges} onSelect={(n: any) => setSelectedPid(n.id)} />
      </div>
      <div style={{ flex: 1 }}>
        <DetailPanel
          node={selectedNode}
          verdict={verdict}
          onBlock={block}
          onAllow={allow}
        />
      </div>
    </div>
  );
}
