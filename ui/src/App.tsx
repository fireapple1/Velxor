import { ReactFlow, Background } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useState } from "react";

type WsMessage = {
  schema_version: string;
  seq: number;
  type: "node_add" | "node_update" | "verdict" | "alert" | "gap";
  payload: any;
};

export default function App() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [verdict, setVerdict] = useState<any>(null);

  useEffect(() => {
    let lastSeq = 0;
    let backoff = 250;

    const connect = () => {
      const ws = new WebSocket(`ws://127.0.0.1:7000?last_seq=${lastSeq}`);

      ws.onopen = () => { backoff = 250; };

      ws.onmessage = (e) => {
        const m: WsMessage = JSON.parse(e.data);
        if (m.seq <= lastSeq) return;          // dedupe
        lastSeq = m.seq;

        if (m.type === "node_add") {
          setNodes((ns) => [...ns, {
            id: String(m.payload.pid ?? Math.random()),
            data: { label: `pid ${m.payload.pid}`, ...m.payload },
            position: { x: Math.random() * 800, y: Math.random() * 600 },
            style: { background: "#888" },
          }]);
        } else if (m.type === "node_update") {
          setNodes((ns) => ns.map(n => n.id === String(m.payload.pid) ? { ...n, data: { ...n.data, ...m.payload } } : n));
        } else if (m.type === "verdict") {
          setVerdict(m.payload);
          if (m.payload?.verdict === "ransomware") {
            setNodes((ns) => ns.map(n => n.id === String(m.payload.pid) ? { ...n, style: { background: "#e53935", animation: "pulse 0.5s infinite" } } : n));
          }
        } else if (m.type === "gap") {
          // 5초 replay 윈도우 외 → full refresh
          setNodes([]); setEdges([]); setVerdict(null); lastSeq = 0;
        }
      };

      ws.onclose = () => {
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 5000);
      };
      ws.onerror = () => { ws.close(); };
    };

    connect();
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex" }}>
      <div style={{ flex: 3 }}>
        <ReactFlow nodes={nodes} edges={edges}><Background /></ReactFlow>
      </div>
      <div style={{ flex: 1, padding: 16, background: "#222", color: "#fff" }}>
        <h3>Detail Panel</h3>
        {verdict ? (
          <pre>{JSON.stringify(verdict, null, 2)}</pre>
        ) : <p>(no verdict yet)</p>}
      </div>
    </div>
  );
}