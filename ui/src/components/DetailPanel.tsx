import { allow } from "../api/block";
import { BlockButton } from "./BlockButton";
import type { Verdict } from "../types";
import type { VelxorNode } from "./ProcessTree";

type Props = {
  node: VelxorNode | null;
  verdict: Verdict | null;
  onBlocked: (pid: number, outcome: string) => void;
};

const PANEL: React.CSSProperties = {
  background: "#0d0d11",
  color: "#00ffcc",
  fontFamily: "inherit",
  fontSize: 13,
  padding: 16,
  height: "100%",
  borderLeft: "1px solid #00ffcc33",
  overflowY: "auto",
  animation: "slide-in 0.3s ease-out",
};

const LABEL: React.CSSProperties = { color: "#00ffcc99", fontSize: 11, letterSpacing: 0.5 };
const VAL: React.CSSProperties = { color: "#00ffcc", wordBreak: "break-all", marginTop: 2 };

export function DetailPanel({ node, verdict, onBlocked }: Props) {
  if (!node) {
    return (
      <div style={PANEL}>
        <div style={{ color: "#00ffcc55" }}>// 노드를 선택하세요</div>
      </div>
    );
  }

  // id 는 항상 String(pid) — Number(node.id) 단일 소스로 비교 일관성 확보
  const pid = Number(node.id);
  const verdictForNode = verdict && verdict.pid === pid ? verdict : null;
  const isThreat = verdictForNode?.verdict === "ransomware";
  const isKilled = node.data.state === "killed";

  const verdictColor = isThreat ? "#ff3333" : "#00ffcc";

  // key 에 verdict/killed 포함 → 같은 노드 안에서 verdict 도착 또는 killed 전이 시 슬라이드인 재발동
  const slideKey = `${pid}-${verdictForNode?.verdict ?? "pending"}-${isKilled ? "k" : "a"}`;

  return (
    <div style={PANEL} key={slideKey}>
      <div style={{ marginBottom: 16, borderBottom: "1px solid #00ffcc22", paddingBottom: 8 }}>
        <div style={LABEL}>PROCESS</div>
        <div style={{ ...VAL, fontSize: 18, fontWeight: 600 }}>PID {pid}</div>
      </div>

      <Field label="IMAGE" value={String(node.data.image_path ?? "-")} />
      <Field label="PARENT PID" value={String(node.data.parent_pid ?? "-")} />
      <Field label="EVENT TYPE" value={String(node.data.event_type ?? "-")} />
      {typeof node.data.file_path === "string" && (
        <Field label="FILE PATH" value={node.data.file_path} />
      )}
      <Field label="STATE" value={String(node.data.state)} valueColor={isKilled ? "#999" : isThreat ? "#ff3333" : "#00ffcc"} />

      <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid #00ffcc22" }}>
        <div style={LABEL}>VERDICT</div>
        <div style={{ ...VAL, color: verdictColor, fontSize: 16, marginTop: 4 }}>
          {verdictForNode?.verdict ?? "(pending)"}
        </div>

        {verdictForNode && (
          <>
            <div style={{ ...LABEL, marginTop: 12 }}>CONFIDENCE</div>
            <div style={{ ...VAL, color: verdictColor, fontSize: 24, fontWeight: 700 }}>
              {verdictForNode.confidence.toFixed(2)}
            </div>

            <div style={{ ...LABEL, marginTop: 12 }}>EVIDENCE</div>
            <ul style={{ margin: "4px 0 0 18px", padding: 0, color: isThreat ? "#ff5555" : "#00ffcc" }}>
              {verdictForNode.evidence.map((e, i) => (
                <li key={i} style={{ marginBottom: 2 }}>
                  {e}
                </li>
              ))}
            </ul>

            <div style={{ ...LABEL, marginTop: 12 }}>MODEL</div>
            <div style={VAL}>{verdictForNode.model_version}</div>
          </>
        )}
      </div>

      <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid #00ffcc22" }}>
        <BlockButton
          pid={pid}
          onBlocked={(outcome) => onBlocked(pid, outcome)}
          disabled={isKilled}
        />
        <button
          onClick={() => void allow(pid)}
          disabled={isKilled}
          style={{
            background: "#2a2a2a",
            border: "1px solid #00ffcc",
            color: "#00ffcc",
            fontFamily: "inherit",
            fontSize: 13,
            padding: "10px 18px",
            borderRadius: 3,
            cursor: isKilled ? "not-allowed" : "pointer",
            opacity: isKilled ? 0.5 : 1,
          }}
        >
          ALLOW
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={LABEL}>{label}</div>
      <div style={{ ...VAL, color: valueColor ?? "#00ffcc" }}>{value}</div>
    </div>
  );
}
