import { ReactFlow, Background, Controls, Handle, Position } from "@xyflow/react";
import type { Node, Edge, NodeProps, NodeTypes } from "@xyflow/react";
import dagre from "dagre";
import { useMemo } from "react";

export type VelxorNodeState = "normal" | "threat" | "killed";

export type VelxorNodeData = {
  label: string;
  state: VelxorNodeState;
  image_path?: string;
  pid?: number;
  [key: string]: unknown;
};

export type VelxorNode = Node<VelxorNodeData, "velxor">;

type Props = {
  nodes: VelxorNode[];
  edges: Edge[];
  onSelect: (n: VelxorNode) => void;
};

// ★ 납작함을 완전 해결하기 위해 가로/세로를 1:1 완벽 정대칭 정육각형 크기로 고정
const NODE_W = 140;
const NODE_H = 140;

function VelxorNodeView({ data, selected }: NodeProps<VelxorNode>) {
  const isThreat = data.state === "threat";
  const isKilled = data.state === "killed";

  let modeClass = "cyber-normal";
  if (isThreat) modeClass = "cyber-threat";
  if (isKilled) modeClass = "cyber-killed";
  if (selected) modeClass += " cyber-selected";

  const icon = isThreat ? "⚠️" : isKilled ? "🛑" : "⚙️";

  return (
    <div className={`cyber-node ${modeClass}`}>
      {/* 완벽한 정육각형 마스크 레이어 */}
      <div className="cyber-node-bg"></div>
      <div className="cyber-node-inner"></div>

      <Handle type="target" position={Position.Top} className="cyber-handle" />

      {/* 내부 콘텐츠: 양옆 뾰족한 정점 영역을 침범하지 않도록 내부 사각형 마진 확보 */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        textAlign: "center",
        zIndex: 1,
        padding: "0 20px", // 양옆 마진 확보
        pointerEvents: "none",
        boxSizing: "border-box"
      }}>
        {/* 아이콘 */}
        <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
        
        {/* 프로세스 이름 */}
        <div style={{ 
          fontWeight: 700, 
          fontSize: 12, 
          width: "100%", 
          overflow: "hidden", 
          textOverflow: "ellipsis", 
          whiteSpace: "nowrap",
          letterSpacing: "0.5px"
        }}>
          {data.label}
        </div>
        
        {/* 네온 구분선 */}
        <div style={{ 
          width: "45px", 
          height: "1px", 
          background: isThreat ? "rgba(255,51,51,0.7)" : isKilled ? "#444" : "rgba(0,194,255,0.7)", 
          margin: "5px 0" 
        }} />

        {/* PID 출력 */}
        {typeof data.pid === "number" && (
          <div style={{ fontSize: 10, opacity: 0.6, fontFamily: "monospace", fontWeight: 600 }}>
            ID: {data.pid}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="cyber-handle" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  velxor: VelxorNodeView,
};

// Topology signature: layout 은 graph 구조 (node id 집합 + edge 집합) 변경 시에만 재계산.
// data/state 변경 (verdict, killed, evidence 등) 만으로는 layout 재계산 안 함 — PID drift 방지.
// (Codex 2차 audit UI #1 HIGH 해소)
function topologyKey(nodes: VelxorNode[], edges: Edge[]): string {
  const nodeIds = nodes.map((n) => n.id).sort().join("|");
  const edgeIds = edges.map((e) => `${e.source}->${e.target}`).sort().join("|");
  return `${nodeIds}::${edgeIds}`;
}

function computePositions(
  nodeIds: string[],
  edges: Edge[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodeIds.length === 0) return positions;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 75,
    ranksep: 100,
  });
  const idSet = new Set(nodeIds);
  nodeIds.forEach((id) => g.setNode(id, { width: NODE_W, height: NODE_H }));
  // 양 끝 node 가 모두 존재할 때만 edge 등록 — 누락된 parentPid 가 implicit node 로
  // 등재돼 rank 가 매 update 마다 늘어나는 것을 방지 (drift 보강 안전망).
  edges.forEach((e) => {
    if (idSet.has(e.source) && idSet.has(e.target)) {
      g.setEdge(e.source, e.target);
    }
  });

  dagre.layout(g);

  for (const id of nodeIds) {
    const pos = g.node(id);
    if (pos) {
      positions.set(id, {
        x: pos.x - NODE_W / 2,
        y: pos.y - NODE_H / 2,
      });
    }
  }
  return positions;
}

export function ProcessTree({ nodes, edges, onSelect }: Props) {
  const layoutSig = useMemo(() => topologyKey(nodes, edges), [nodes, edges]);
  const positions = useMemo(
    () => computePositions(nodes.map((n) => n.id), edges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutSig],
  );

  const laidOut = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        position: positions.get(n.id) ?? n.position,
      })),
    [nodes, positions],
  );

  return (
    <ReactFlow
      nodes={laidOut}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelect(n as VelxorNode)}
      fitView
      style={{ background: "transparent" }}
      proOptions={{ hideAttribution: false }}
      defaultEdgeOptions={{
        style: { stroke: "#00C2FF", strokeWidth: 1.5, opacity: 0.5 },
        animated: true,
      }}
    >
      <Background color="#1E2936" gap={28} size={1} />
      <Controls />
    </ReactFlow>
  );
}