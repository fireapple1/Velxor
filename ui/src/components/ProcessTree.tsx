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

const NODE_W = 140;
const NODE_H = 44;

function VelxorNodeView({ data }: NodeProps<VelxorNode>) {
  const base: React.CSSProperties = {
    width: NODE_W,
    height: NODE_H,
    padding: "8px 12px",
    borderRadius: 4,
    fontFamily: "inherit",
    fontSize: 12,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  };

  let style: React.CSSProperties;
  let className = "";

  if (data.state === "threat") {
    style = {
      ...base,
      background: "#1a0505",
      border: "2px solid #ff3333",
      color: "#ff3333",
      animation: "pulse 0.8s infinite",
    };
  } else if (data.state === "killed") {
    style = {
      ...base,
      background: "#444",
      border: "2px solid #666",
      color: "#999",
      animation: "none",
    };
    className = "velxor-node-killed";
  } else {
    style = {
      ...base,
      background: "#2a2a2a",
      border: "2px solid #00ffcc",
      color: "#00ffcc",
    };
  }

  return (
    <div style={style} className={className}>
      <Handle type="target" position={Position.Top} style={{ background: "#00ffcc", border: "none" }} />
      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{data.label}</div>
      {typeof data.image_path === "string" && (
        <div
          style={{
            fontSize: 10,
            opacity: 0.7,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.image_path.split("/").pop()}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: "#00ffcc", border: "none" }} />
    </div>
  );
}

const nodeTypes: NodeTypes = { velxor: VelxorNodeView };

function layoutFull(nodes: VelxorNode[], edges: Edge[]): VelxorNode[] {
  if (nodes.length === 0) return nodes;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return pos ? { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } } : n;
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
      style={{ background: "#0a0a0c" }}
      proOptions={{ hideAttribution: false }}
    >
      <Background color="#00ffcc22" gap={20} />
      <Controls />
    </ReactFlow>
  );
}
