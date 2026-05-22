// DetailPanel — 선택된 프로세스의 메타 + verdict + Block/Allow 버튼.
// outcome 6종은 OUTCOME_LABEL 매핑으로 단일 소스 유지.

import { useState } from "react";
import type { ProcessNode } from "../state/graph";
import type { BlockOutcome } from "../types/wire";
import { blockPid, OUTCOME_LABEL } from "../api/block";

interface Props {
  node: ProcessNode | null;
  onBlockResult: (pid: number, outcome: BlockOutcome) => void;
}

export function DetailPanel({ node, onBlockResult }: Props) {
  const [pending, setPending] = useState(false);

  if (!node) {
    return (
      <aside className="detail-panel empty">
        <h2>Detail Panel</h2>
        <p className="hint">노드를 클릭하면 PID, image, verdict, evidence를 보여드립니다.</p>
      </aside>
    );
  }

  const verdict = node.verdict;
  const outcome = node.blocked_outcome as BlockOutcome | undefined;
  const outcomeMeta = outcome ? OUTCOME_LABEL[outcome] : null;
  const isMalicious = verdict?.verdict === "ransomware";

  const handleBlock = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await blockPid(node.pid);
      onBlockResult(res.pid, res.outcome);
    } finally {
      setPending(false);
    }
  };

  return (
    <aside className={`detail-panel ${isMalicious ? "malicious" : ""}`}>
      <header>
        <h2>PID {node.pid}</h2>
        {verdict && (
          <span className={`badge ${verdict.verdict}`}>
            {verdict.verdict.toUpperCase()} · {(verdict.confidence * 100).toFixed(0)}%
          </span>
        )}
      </header>

      <dl className="meta">
        <dt>Image</dt><dd>{node.image_path}</dd>
        <dt>Parent PID</dt><dd>{node.parent_pid}</dd>
        <dt>최초 관측</dt><dd>{new Date(node.first_seen_ms).toLocaleTimeString()}</dd>
        <dt>최근 이벤트</dt><dd>{new Date(node.last_event_ms).toLocaleTimeString()}</dd>
        <dt>FileWrite</dt><dd>{node.write_count}</dd>
        <dt>FileRename</dt><dd>{node.rename_count}</dd>
        <dt>ProcessCreate</dt><dd>{node.spawn_count}</dd>
      </dl>

      {verdict && (
        <section className="evidence">
          <h3>Evidence</h3>
          <ul>
            {verdict.evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          {verdict.evidence_v2 && verdict.evidence_v2.length > 0 && (
            <ul className="evidence-v2">
              {verdict.evidence_v2.map((e, i) => (
                <li key={i} data-severity={e.severity ?? 0}>
                  <strong>{e.key}</strong>: {e.value}
                </li>
              ))}
            </ul>
          )}
          <p className="model">model: {verdict.model_version}</p>
        </section>
      )}

      <footer className="actions">
        <button
          type="button"
          className="btn block"
          onClick={handleBlock}
          disabled={pending}
        >
          {pending ? "차단 중..." : "Block"}
        </button>
        {outcomeMeta && (
          <span className={`outcome ${outcomeMeta.tone}`}>{outcomeMeta.text}</span>
        )}
      </footer>
    </aside>
  );
}
