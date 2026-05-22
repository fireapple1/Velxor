// UI graph state — WsMessage 입력 → node/edge/verdict 도출.
// reducer 패턴으로 dedupe + gap reset + verdict 머지를 한 곳에 격리.

import { useReducer } from "react";
import type { BehaviorEventV1, ClassifyResponse, WsMessage } from "../types/wire";

export interface ProcessNode {
  id: string;
  pid: number;
  parent_pid: number;
  image_path: string;
  first_seen_ms: number;
  last_event_ms: number;
  write_count: number;
  rename_count: number;
  spawn_count: number;
  verdict?: ClassifyResponse;
  blocked_outcome?: string;
}

export interface TimelineEntry {
  seq: number;
  ts: number;
  pid?: number;
  kind: "event" | "verdict" | "alert" | "gap";
  label: string;
}

export interface GraphState {
  nodes: Record<string, ProcessNode>;
  order: string[]; // 시간순 PID id
  timeline: TimelineEntry[];
  status: "connecting" | "open" | "closed";
  lastSeq: number;
  gapCount: number;
}

export const initialGraphState: GraphState = {
  nodes: {},
  order: [],
  timeline: [],
  status: "connecting",
  lastSeq: 0,
  gapCount: 0,
};

export type GraphAction =
  | { kind: "ws"; msg: WsMessage }
  | { kind: "status"; status: GraphState["status"] }
  | { kind: "block_result"; pid: number; outcome: string }
  | { kind: "reset" };

const TIMELINE_MAX = 80;

function pushTimeline(timeline: TimelineEntry[], entry: TimelineEntry): TimelineEntry[] {
  const next = timeline.length >= TIMELINE_MAX ? timeline.slice(-TIMELINE_MAX + 1) : timeline.slice();
  next.push(entry);
  return next;
}

function incEventCounter(node: ProcessNode, evt: BehaviorEventV1): ProcessNode {
  const next: ProcessNode = { ...node, last_event_ms: evt.ts_unix_ms };
  switch (evt.event_type) {
    case "FileWrite": next.write_count = node.write_count + 1; break;
    case "FileRename": next.rename_count = node.rename_count + 1; break;
    case "ProcessCreate": next.spawn_count = node.spawn_count + 1; break;
  }
  return next;
}

export function graphReducer(state: GraphState, action: GraphAction): GraphState {
  switch (action.kind) {
    case "status":
      return { ...state, status: action.status };

    case "reset":
      return { ...initialGraphState, status: state.status, gapCount: state.gapCount + 1 };

    case "block_result": {
      const id = String(action.pid);
      const node = state.nodes[id];
      if (!node) return state;
      const nextNodes = { ...state.nodes, [id]: { ...node, blocked_outcome: action.outcome } };
      const tl = pushTimeline(state.timeline, {
        seq: state.lastSeq,
        ts: Date.now(),
        pid: action.pid,
        kind: "alert",
        label: `block ${action.outcome}`,
      });
      return { ...state, nodes: nextNodes, timeline: tl };
    }

    case "ws": {
      const msg = action.msg;

      if (msg.type === "gap") {
        const tl = pushTimeline(state.timeline, {
          seq: 0,
          ts: Date.now(),
          kind: "gap",
          label: `gap ${msg.payload.from}..${msg.payload.to}`,
        });
        return { ...initialGraphState, status: state.status, timeline: tl, gapCount: state.gapCount + 1 };
      }

      const nextLastSeq = Math.max(state.lastSeq, msg.seq);

      if (msg.type === "node_add") {
        const evt = msg.payload;
        const id = String(evt.pid);
        const existing = state.nodes[id];
        const baseNode: ProcessNode = existing ?? {
          id,
          pid: evt.pid,
          parent_pid: evt.parent_pid,
          image_path: evt.image_path,
          first_seen_ms: evt.ts_unix_ms,
          last_event_ms: evt.ts_unix_ms,
          write_count: 0,
          rename_count: 0,
          spawn_count: 0,
        };
        const updated = incEventCounter(baseNode, evt);
        const nodes = { ...state.nodes, [id]: updated };
        const order = existing ? state.order : [...state.order, id];
        const tl = pushTimeline(state.timeline, {
          seq: msg.seq,
          ts: evt.ts_unix_ms,
          pid: evt.pid,
          kind: "event",
          label: `${evt.event_type} ${evt.file_path ?? ""}`.trim(),
        });
        return { ...state, nodes, order, timeline: tl, lastSeq: nextLastSeq };
      }

      if (msg.type === "node_update") {
        const id = String(msg.payload.pid);
        const existing = state.nodes[id];
        if (!existing) return { ...state, lastSeq: nextLastSeq };
        const merged: ProcessNode = { ...existing, ...(msg.payload.fields as Partial<ProcessNode>) };
        return { ...state, nodes: { ...state.nodes, [id]: merged }, lastSeq: nextLastSeq };
      }

      if (msg.type === "verdict") {
        const pid = msg.payload.pid;
        if (pid == null) return { ...state, lastSeq: nextLastSeq };
        const id = String(pid);
        const existing = state.nodes[id];
        if (!existing) return { ...state, lastSeq: nextLastSeq };
        const nodes = { ...state.nodes, [id]: { ...existing, verdict: msg.payload } };
        const tl = pushTimeline(state.timeline, {
          seq: msg.seq,
          ts: Date.now(),
          pid,
          kind: "verdict",
          label: `${msg.payload.verdict} ${(msg.payload.confidence * 100).toFixed(0)}%`,
        });
        return { ...state, nodes, timeline: tl, lastSeq: nextLastSeq };
      }

      if (msg.type === "alert") {
        const tl = pushTimeline(state.timeline, {
          seq: msg.seq,
          ts: Date.now(),
          pid: msg.payload.pid,
          kind: "alert",
          label: `${msg.payload.severity}: ${msg.payload.message}`,
        });
        return { ...state, timeline: tl, lastSeq: nextLastSeq };
      }

      return state;
    }
  }
}

export function useGraphState() {
  return useReducer(graphReducer, initialGraphState);
}
