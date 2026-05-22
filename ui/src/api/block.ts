export async function block(pid: number) {
  const r = await fetch(`http://127.0.0.1:7001/block/${pid}`, { method: "POST" });
  return r.text();
}
export async function allow(pid: number) {
  const r = await fetch(`http://127.0.0.1:7001/allow/${pid}`, { method: "POST" });
  return r.text();
}