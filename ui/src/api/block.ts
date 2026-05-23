// Backend (rust-service/src/blocker.rs Outcome enum) wire 값과 정합:
//   killed | terminated | already_gone | eperm | invalid | error
// Codex 2차 audit UI #3 HIGH 해소 — 이전 UI enum (already_dead/permission_denied/not_found/unknown)
// 은 backend wire 값과 mismatch 라 already_gone 응답이 killed state 로 반영 안 됐음.
export type BlockOutcome =
  | "killed"
  | "terminated"
  | "already_gone"
  | "eperm"
  | "invalid"
  | "error";

export type BlockResult = { ok: boolean; outcome: BlockOutcome | "unknown"; raw: string; status?: number };
export type AllowResult = { ok: boolean; raw: string; status?: number };

export async function block(pid: number): Promise<BlockResult> {
  try {
    const r = await fetch(`http://127.0.0.1:7001/block/${pid}`, { method: "POST" });
    const raw = await r.text();
    if (!r.ok) {
      return { ok: false, outcome: "unknown", raw, status: r.status };
    }
    try {
      const parsed = JSON.parse(raw);
      const outcome = (parsed?.outcome ?? "unknown") as BlockOutcome;
      return { ok: true, outcome, raw, status: r.status };
    } catch {
      return { ok: false, outcome: "unknown", raw, status: r.status };
    }
  } catch (e) {
    return { ok: false, outcome: "unknown", raw: String(e) };
  }
}

// 주의: backend rust-service 는 /allow route 미구현. 호출 시 404 → ok=false 반환.
// Codex 2차 audit UI: backend route 추가 또는 UI 측 Allow 버튼 비활성화 권장.
export async function allow(pid: number): Promise<AllowResult> {
  try {
    const r = await fetch(`http://127.0.0.1:7001/allow/${pid}`, { method: "POST" });
    const raw = await r.text();
    return { ok: r.ok, raw, status: r.status };
  } catch (e) {
    return { ok: false, raw: String(e) };
  }
}
