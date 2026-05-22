// Wire 타입 — contracts/interface-schema.md v1.0 + handoff-week4-5.md §3, §4 와 1:1 대응.
// v1.1 collation 후보: ClassifyResponse.evidence_v2 (contracts/B to A (1) 제출).

export type EventType = "FileWrite" | "FileRename" | "ProcessCreate";

export interface BehaviorEventV1 {
  schema_version: "1.0";
  seq: number;
  dropped_since_last: number;
  pid: number;
  parent_pid: number;
  image_path: string;
  event_type: EventType;
  file_path?: string | null;
  volume_id?: string | null;
  op_detail?: Record<string, unknown> | null;
  ts_unix_ms: number;
}

export type Verdict = "benign" | "ransomware";

export interface ClassifyResponse {
  verdict: Verdict;
  confidence: number;
  evidence: string[];
  model_version: string;
  evidence_v2?: { key: string; value: string; severity?: number }[];
}

export type WsMessage =
  | { schema_version: "1.0"; seq: number; type: "node_add"; payload: BehaviorEventV1 }
  | { schema_version: "1.0"; seq: number; type: "node_update"; payload: { pid: number; fields: Record<string, unknown> } }
  | { schema_version: "1.0"; seq: number; type: "verdict"; payload: ClassifyResponse & { pid?: number } }
  | { schema_version: "1.0"; seq: number; type: "alert"; payload: { pid: number; severity: string; message: string } }
  | { schema_version: "1.0"; seq: 0; type: "gap"; payload: { from: number; to: number } };

export type BlockOutcome =
  | "killed"
  | "terminated"
  | "already_gone"
  | "eperm"
  | "invalid"
  | "error";

export interface BlockResponse {
  pid: number;
  outcome: BlockOutcome;
}
