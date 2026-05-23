import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
} from "@xyflow/react";
import type { Edge, Node, NodeProps, NodeTypes } from "@xyflow/react";
import type { ComponentType } from "react";
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

const NODE_W = 150;
const NODE_H = 130;

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
      <div className="cyber-node-bg" />
      <div className="cyber-node-inner" />

      <Handle type="target" position={Position.Top} className="cyber-handle" />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          textAlign: "center",
          zIndex: 1,
          padding: "0 20px",
          pointerEvents: "none",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>

        <div
          style={{
            fontWeight: 700,
            fontSize: 12,
            width: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            letterSpacing: "0.5px",
          }}
        >
          {data.label}
        </div>

        <div
          style={{
            width: "45px",
            height: "1px",
            background: isThreat
              ? "rgba(255,51,51,0.7)"
              : isKilled
                ? "#444"
                : "rgba(0,194,255,0.7)",
            margin: "5px 0",
          }}
        />

        {typeof data.pid === "number" && (
          <div
            style={{
              fontSize: 10,
              opacity: 0.6,
              fontFamily: "monospace",
              fontWeight: 600,
            }}
          >
            ID: {data.pid}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="cyber-handle"
      />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  velxor: VelxorNodeView as ComponentType<any>,
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

  nodes.forEach((n) => {
    g.setNode(n.id, {
      width: NODE_W,
      height: NODE_H,
    });
  });

  edges.forEach((e) => {
    g.setEdge(e.source, e.target);
  });

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);

    if (!pos) return n;

    return {
      ...n,
      position: {
        x: pos.x - NODE_W / 2,
        y: pos.y - NODE_H / 2,
      },
    };
  });
}

export function ProcessTree({ nodes, edges, onSelect }: Props) {
  const laidOut = useMemo(() => layoutFull(nodes, edges), [nodes, edges]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <ReactFlow
        nodes={laidOut}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => onSelect(n as VelxorNode)}
        fitView
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
        }}
        proOptions={{
          hideAttribution: true,
        }}
        defaultEdgeOptions={{
          style: {
            stroke: "#00C2FF",
            strokeWidth: 1.5,
            opacity: 0.5,
          },
          animated: true,
        }}
      >
        <Background color="#1E2936" gap={28} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}