import { ReactFlow, Background, Controls } from "@xyflow/react";
import dagre from "dagre";
import { useEffect, useMemo, useState } from "react";

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));
dagreGraph.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });

function layoutFull(nodes: any[], edges: any[]) {
  nodes.forEach(n => dagreGraph.setNode(n.id, { width: 120, height: 40 }));
  edges.forEach(e => dagreGraph.setEdge(e.source, e.target));
  dagre.layout(dagreGraph);
  return nodes.map(n => {
    const pos = dagreGraph.node(n.id);
    return { ...n, position: { x: pos.x - 60, y: pos.y - 20 } };
  });
}

function placeIncremental(nodes: any[], parentId: string, childId: string) {
  // 동일 부모의 후속 자식은 manual x+=80 stack (full dagre 비호출)
  const parent = nodes.find(n => n.id === parentId);
  if (!parent) return nodes;
  const siblings = nodes.filter(n => n.data?.parentId === parentId);
  const x = parent.position.x + 80 * siblings.length;
  return nodes.map(n => n.id === childId ? { ...n, position: { x, y: parent.position.y + 100 } } : n);
}

export function ProcessTree({ nodes, edges, onSelect }: any) {
  return (
    <ReactFlow nodes={nodes} edges={edges} onNodeClick={(_, n) => onSelect(n)}>
      <Background /><Controls />
    </ReactFlow>
  );
}