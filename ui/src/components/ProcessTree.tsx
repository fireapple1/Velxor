import { ReactFlow, Background, Controls } from "@xyflow/react";
import dagre from "dagre";
import { useMemo } from "react";

function layoutFull(nodes: any[], edges: any[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });
  nodes.forEach(n => g.setNode(n.id, { width: 120, height: 40 }));
  edges.forEach(e => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map(n => {
    const pos = g.node(n.id);
    return pos ? { ...n, position: { x: pos.x - 60, y: pos.y - 20 } } : n;
  });
}

export function ProcessTree({ nodes, edges, onSelect }: any) {
  const laidOut = useMemo(() => layoutFull(nodes, edges), [nodes, edges]);
  return (
    <ReactFlow nodes={laidOut} edges={edges} onNodeClick={(_, n) => onSelect(n)}>
      <Background /><Controls />
    </ReactFlow>
  );
}