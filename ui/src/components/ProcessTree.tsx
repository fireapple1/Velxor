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

    minHeight: NODE_H,

    padding: "12px",

    borderRadius: 12,

    fontFamily: "inherit",
    fontSize: 12,

    display: "flex",
    flexDirection: "column",
    justifyContent: "center",

    overflow: "hidden",

    whiteSpace: "nowrap",
    textOverflow: "ellipsis",

    transition:
      "border-color 0.2s ease, background 0.2s ease",

    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
  };

  let style: React.CSSProperties;
  let className = "";

  if (data.state === "threat") {
    style = {
      ...base,
      background: "rgba(255,77,79,0.08)",
      border: "1px solid #FF4D4F",
      color: "#FF4D4F",
    };
  } else if (data.state === "killed") {
    style = {
      ...base,
      background: "#161B22",
      border: "1px solid #30363D",
      color: "#8B949E",
      opacity: 0.55,
      filter: "grayscale(0.4)",
    };
    className = "velxor-node-killed";
  } else {
    style = {
      ...base,
      background: "#121821",
      border: "1px solid #1E2936",
      color: "#E6EDF3",
    };
  }

  return (
    <div style={style} className={className}>
      <Handle type="target" position={Position.Top} style={{
        background: "#00C2FF",
        border: "none",

        width: 8,
        height: 8,
      }}/>
      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{data.label}</div>
      {typeof data.image_path === "string" && (
        <div
          style={{
            fontSize: 10,
            opacity: 0.6,
            color: "#8B949E",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.image_path.split("/").pop()}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{
        background: "#00C2FF",
        border: "none",

        width: 8,
        height: 8,
      }}/>
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
      style={{
        background: "#0B0F14",

        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
        `,

        backgroundSize: "32px 32px",
      }}
      proOptions={{ hideAttribution: false }}
    >
      <Background
        color="rgba(255,255,255,0.04)"
        gap={32}
      />
      <Controls />
    </ReactFlow>
  );
}
