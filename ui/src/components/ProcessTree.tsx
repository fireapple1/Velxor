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

function layoutFull(nodes: VelxorNode[], edges: Edge[]): VelxorNode[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 75, 
    ranksep: 100,
  });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return pos
      ? {
          ...n,
          position: {
            x: pos.x - NODE_W / 2,
            y: pos.y - NODE_H / 2,
          },
        }
      : n;
  });
}

export function ProcessTree({ nodes, edges, onSelect }: Props) {
  const laidOut = useMemo(() => layoutFull(nodes, edges), [nodes, edges]);

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