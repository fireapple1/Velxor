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

// ★ 노드 크기를 큼직한 전문가용/사이버펑크용으로 키움
const NODE_W = 180;
const NODE_H = 70;

function VelxorNodeView({ data, selected }: NodeProps<VelxorNode>) {
  const isThreat = data.state === "threat";
  const isKilled = data.state === "killed";

  // 상태에 따른 색상 정의
  const borderColor = isThreat ? "#ff3333" : isKilled ? "#30363D" : "#00C2FF";
  const bgColor = isThreat ? "rgba(255, 77, 79, 0.15)" : isKilled ? "rgba(22, 27, 34, 0.8)" : "rgba(18, 24, 33, 0.92)";
  const textColor = isThreat ? "#FF7B72" : isKilled ? "#8B949E" : "#E6EDF3";
  const icon = isThreat ? "⚠️" : isKilled ? "🛑" : "⚙️";

  // ★ 사이버펑크 헥사곤(Clip-path) 스타일 베이스
  const baseStyle: React.CSSProperties = {
    width: NODE_W,
    minHeight: NODE_H,
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    fontFamily: "inherit",
    background: bgColor,
    color: textColor,
    // SF 스타일의 모서리 깎임 효과
    clipPath: "polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)",
    // 가짜 테두리를 위한 outline (clip-path 사용시 border가 잘림)
    boxShadow: selected ? `inset 0 0 0 2px ${borderColor}, 0 0 16px ${borderColor}80` : `inset 0 0 0 1px ${borderColor}`,
    transition: "all 0.2s ease",
    backdropFilter: "blur(10px)",
    cursor: "pointer",
    // 핏빛 애니메이션 (threat 상태일 때만 css 클래스로 동작)
    animation: isThreat ? "threatPulse 1s infinite" : "none",
    filter: isKilled ? "grayscale(0.8)" : "none",
  };

  return (
    <div
      style={baseStyle}
      onMouseEnter={(e) => {
        if (!isKilled) {
          e.currentTarget.style.transform = "translateY(-3px)";
          e.currentTarget.style.boxShadow = `inset 0 0 0 2px ${borderColor}, 0 0 12px ${borderColor}60`;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0px)";
        e.currentTarget.style.boxShadow = selected 
          ? `inset 0 0 0 2px ${borderColor}, 0 0 16px ${borderColor}80` 
          : `inset 0 0 0 1px ${borderColor}`;
      }}
    >
      {/* 연결선 핸들 (위) */}
      <Handle type="target" position={Position.Top} style={{ background: borderColor, border: "none", width: 8, height: 8 }} />

      {/* 노드 내부 콘텐츠 배치 */}
      <div style={{ fontSize: 20, marginRight: 12 }}>{icon}</div>
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {data.label}
        </div>
        
        {/* 프로세스 경로 표시 */}
        {typeof data.image_path === "string" && (
          <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {data.image_path.split(/[/\\]/).pop()}
          </div>
        )}
        
        {/* PID 표시 */}
        {typeof data.pid === "number" && (
          <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2, fontFamily: "monospace" }}>
            PID: {data.pid}
          </div>
        )}
      </div>

      {/* 연결선 핸들 (아래) */}
      <Handle type="source" position={Position.Bottom} style={{ background: borderColor, border: "none", width: 8, height: 8 }} />
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
    nodesep: 60, // 노드가 커졌으므로 간격도 넓힘
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
      style={{
        background: "transparent", // App.tsx의 배경을 투과하기 위해 투명으로 변경
      }}
      proOptions={{ hideAttribution: false }}
      defaultEdgeOptions={{
        style: {
          stroke: "#00C2FF", // 엣지 색상도 사이버펑크 톤으로 변경
          strokeWidth: 1.5,
          opacity: 0.6,
        },
        animated: true, // 데이터가 흐르는 효과
      }}
    >
      {/* 기존 React Flow의 점 배경 유지 */}
      <Background color="#1E2936" gap={28} size={1} />
      <Controls />
    </ReactFlow>
  );
}