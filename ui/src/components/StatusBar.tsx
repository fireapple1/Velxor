// StatusBar — WS 연결 상태 + gap 카운트 + 마지막 seq.

interface Props {
  status: "connecting" | "open" | "closed";
  lastSeq: number;
  gapCount: number;
  nodeCount: number;
}

const STATUS_LABEL: Record<Props["status"], string> = {
  connecting: "연결 중",
  open: "수신 중",
  closed: "재접속 대기",
};

export function StatusBar({ status, lastSeq, gapCount, nodeCount }: Props) {
  return (
    <header className="status-bar">
      <strong className="brand">Velxor</strong>
      <span className={`ws-status ${status}`}>{STATUS_LABEL[status]}</span>
      <span className="metric">seq {lastSeq}</span>
      <span className="metric">gap {gapCount}</span>
      <span className="metric">processes {nodeCount}</span>
    </header>
  );
}
