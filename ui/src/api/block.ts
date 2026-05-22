// Block API — A의 contracts/handoff-week4-5.md §4 (:7001 /block/{pid}).
// 환경변수 VELXOR_BLOCK_TOKEN 설정 시 X-Velxor-Token 헤더 필수 (데모 unset 가정, 빈 문자열이면 미발송).

import type { BlockResponse, BlockOutcome } from "../types/wire";

const BLOCK_BASE = "http://127.0.0.1:7001";
// Vite는 import.meta.env로 노출. 런타임 보호도 같이.
const TOKEN = (import.meta as unknown as { env?: { VITE_VELXOR_BLOCK_TOKEN?: string } }).env?.VITE_VELXOR_BLOCK_TOKEN ?? "";

export async function blockPid(pid: number): Promise<BlockResponse> {
  if (!Number.isInteger(pid) || pid <= 1) {
    return { pid, outcome: "invalid" satisfies BlockOutcome };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TOKEN) headers["X-Velxor-Token"] = TOKEN;

  try {
    const res = await fetch(`${BLOCK_BASE}/block/${pid}`, { method: "POST", headers });
    if (!res.ok) {
      return { pid, outcome: "error" satisfies BlockOutcome };
    }
    return (await res.json()) as BlockResponse;
  } catch {
    return { pid, outcome: "error" satisfies BlockOutcome };
  }
}

export const OUTCOME_LABEL: Record<BlockOutcome, { text: string; tone: "danger" | "warn" | "muted" }> = {
  killed: { text: "강제 종료", tone: "danger" },
  terminated: { text: "종료", tone: "warn" },
  already_gone: { text: "이미 종료됨", tone: "muted" },
  eperm: { text: "권한 부족", tone: "danger" },
  invalid: { text: "잘못된 PID", tone: "danger" },
  error: { text: "차단 실패", tone: "danger" },
};
