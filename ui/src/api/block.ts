export type BlockOutcome =
  | "killed"
  | "terminated"
  | "already_dead"
  | "not_found"
  | "permission_denied"
  | "unknown";

export type BlockResult = { outcome: BlockOutcome; raw: string };
export type AllowResult = { raw: string };

export async function block(pid: number): Promise<BlockResult> {
  try {
    const r = await fetch(`http://127.0.0.1:7001/block/${pid}`, { method: "POST" });
    const raw = await r.text();
    try {
      const parsed = JSON.parse(raw);
      const outcome = (parsed?.outcome ?? "unknown") as BlockOutcome;
      return { outcome, raw };
    } catch {
      return { outcome: "unknown", raw };
    }
  } catch (e) {
    return { outcome: "unknown", raw: String(e) };
  }
}

export async function allow(pid: number): Promise<AllowResult> {
  try {
    const r = await fetch(`http://127.0.0.1:7001/allow/${pid}`, { method: "POST" });
    const raw = await r.text();
    return { raw };
  } catch (e) {
    return { raw: String(e) };
  }
}
