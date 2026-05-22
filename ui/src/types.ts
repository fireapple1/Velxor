// contracts/interface-schema.md v1.0 기준. 스키마 변경 시 동시 갱신.

export type EventType = "FileWrite" | "FileRename" | "ProcessCreate";

export type BehaviorEventV1 = {
  schema_version: string;
  seq: number;
  dropped_since_last: number;
  pid: number;
  parent_pid: number;
  image_path: string;
  event_type: EventType;
  file_path?: string;
  volume_id?: string;
  op_detail?: { file_size?: number; entropy_hint?: number };
  ts_unix_ms: number;
};

export type Verdict = {
  pid: number;
  verdict: "benign" | "ransomware";
  confidence: number;
  evidence: string[];
  model_version: string;
};

export type AlertPayload = {
  pid: number;
  severity: "info" | "warn" | "error";
  message: string;
};

export type GapPayload = { from: number; to: number };

export type NodeUpdatePayload = {
  pid: number;
  fields: Record<string, unknown>;
};

type WsBase = { schema_version: string; seq: number };

export type WsMessage =
  | (WsBase & { type: "node_add"; payload: BehaviorEventV1 })
  | (WsBase & { type: "node_update"; payload: NodeUpdatePayload })
  | (WsBase & { type: "verdict"; payload: Verdict })
  | (WsBase & { type: "alert"; payload: AlertPayload })
  | (WsBase & { type: "gap"; payload: GapPayload });
