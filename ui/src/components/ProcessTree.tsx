// ProcessTree — @xyflow/react + dagre batched layout.
// jank 회피: layout 결과를 useMemo로 캐싱, 노드 추가 시에만 재계산.

import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import type { ProcessNode } from "../state/graph";

interface Props {
  nodes: ProcessNode[];
  selectedPid: number | null;
  onSelect: (pid: number) => void;
}

const NODE_W = 160;
const NODE_H = 56;

function buildLayout(processes: ProcessNode[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 80 });

  const idSet = new Set(processes.map((p) => p.id));
  for (const p of processes) g.setNode(p.id, { width: NODE_W, height: NODE_H });
  const edges: Edge[] = [];
  for (const p of processes) {
    const parent = String(p.parent_pid);
    if (idSet.has(parent) && parent !== p.id) {
      g.setEdge(parent, p.id);
      edges.push({ id: `${parent}->${p.id}`, source: parent, target: p.id });
    }
  }
  dagre.layout(g);

  const rfNodes: Node[] = processes.map((p) => {
    const pos = g.node(p.id);
    const isMalicious = p.verdict?.verdict === "ransomware";
    const isBlocked = !!p.blocked_outcome;
    const className = ["velxor-node"]
      .concat(isMalicious ? ["malicious"] : [])
      .concat(isBlocked ? ["blocked"] : [])
      .join(" ");
    return {
      id: p.id,
      position: { x: (pos?.x ?? 0) - NODE_W / 2, y: (pos?.y ?? 0) - NODE_H / 2 },
      data: { label: `pid ${p.pid}` },
      className,
      style: { width: NODE_W, height: NODE_H },
    };
  });

  return { nodes: rfNodes, edges };
}

export function ProcessTree({ nodes, selectedPid, onSelect }: Props) {
  // 노드 추가/verdict 변화에만 의존 — layout 재계산 비용 격리.
  const layoutKey = useMemo(
    () => nodes.map((n) => `${n.id}|${n.verdict?.verdict ?? ""}|${n.blocked_outcome ?? ""}`).join(","),
    [nodes],
  );
  const layout = useMemo(() => buildLayout(nodes), [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedId = selectedPid != null ? String(selectedPid) : null;
  const decoratedNodes = useMemo(
    () => layout.nodes.map((n) => (n.id === selectedId ? { ...n, selected: true } : n)),
    [layout.nodes, selectedId],
  );

  return (
    <ReactFlow
      nodes={decoratedNodes}
      edges={layout.edges}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, node) => onSelect(Number(node.id))}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} color="#1f2429" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
