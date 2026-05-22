export function DetailPanel({ node, verdict, onBlock, onAllow }: any) {
  if (!node) return <div style={{ padding: 16 }}>(클릭한 프로세스 없음)</div>;
  return (
    <div style={{ padding: 16, background: "#1a1a1a", color: "#fff", height: "100%" }}>
      <h3>PID {node.data.pid}</h3>
      <p>Image: {node.data.image_path}</p>
      <p>Parent PID: {node.data.parent_pid}</p>
      <p>Verdict: {verdict?.verdict ?? "(pending)"}</p>
      <p>Confidence: {verdict?.confidence?.toFixed(2) ?? "-"}</p>
      <ul>{verdict?.evidence?.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
      <button onClick={() => onBlock(node.data.pid)} style={{ background: "#e53935", color: "#fff", padding: 8, marginRight: 8 }}>Block</button>
      <button onClick={() => onAllow(node.data.pid)} style={{ background: "#4caf50", color: "#fff", padding: 8 }}>Allow</button>
    </div>
  );
}