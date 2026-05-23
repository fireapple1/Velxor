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
  background: "#0F141B",

  color: "#E6EDF3",

  fontFamily: "inherit",
  fontSize: 13,

  padding: 16,

  height: "100%",

  borderLeft: "1px solid #1E2936",

  overflowY: "auto",

  animation: "slide-in 0.3s ease-out",
};

const LABEL: React.CSSProperties = {
  color: "#8B949E",

  fontSize: 11,

  letterSpacing: 0.5,

  textTransform: "uppercase",
};
const VAL: React.CSSProperties = {
  color: "#E6EDF3",

  wordBreak: "break-all",

  marginTop: 4,
};

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

  const verdictColor = isThreat ? "#FF4D4F" : "#00C2FF";

  // key 에 verdict/killed 포함 → 같은 노드 안에서 verdict 도착 또는 killed 전이 시 슬라이드인 재발동
  const slideKey = `${pid}-${verdictForNode?.verdict ?? "pending"}-${isKilled ? "k" : "a"}`;

  return (
    <div style={PANEL} key={slideKey}>
      <div style={{ marginBottom: 16, borderBottom: "1px solid #1E2936", paddingBottom: 8 }}>
        <div style={LABEL}>PROCESS</div>
        <div style={{ ...VAL, fontSize: 22, fontWeight: 700,}}>PID {pid}</div>
      </div>

      <Field label="IMAGE" value={String(node.data.image_path ?? "-")} />
      <Field label="PARENT PID" value={String(node.data.parent_pid ?? "-")} />
      <Field label="EVENT TYPE" value={String(node.data.event_type ?? "-")} />
      {typeof node.data.file_path === "string" && (
        <Field label="FILE PATH" value={node.data.file_path} />
      )}
      <Field label="STATE" value={String(node.data.state)} valueColor={
        isKilled
          ? "#8B949E"
          : isThreat
          ? "#FF4D4F"
          : "#00C2FF"
      }/>

      <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid #1E2936" }}>
        <div style={LABEL}>VERDICT</div>
        <div
          style={{
            ...VAL,
            color: verdictColor,
            fontSize: 28,
            fontWeight: 700,
            marginTop: 8,
            letterSpacing: 1,
          }}
        >
          {verdictForNode?.verdict ?? "(pending)"}
        </div>

        {verdictForNode && (
          <>
            <div style={{ ...LABEL, marginTop: 12 }}>
              CONFIDENCE <span style={{ opacity: 0.6, textTransform: "none", letterSpacing: 0 }}>
                (verdict 신뢰도; 1.00 = strong, engine `1 - max_proba` 변환)
              </span>
            </div>
            <div style={{ ...VAL, color: verdictColor, fontSize: 42, fontWeight: 800, lineHeight:1, }}>
              {verdictForNode.confidence.toFixed(2)}
            </div>
            {/* lr_max_proba 노출 — AC5 결과의 ransomware probability 와 의미 정합 */}
            {(() => {
              const lr = verdictForNode.evidence.find((e) => e.startsWith("lr_max_proba="));
              return lr ? (
                <div style={{ marginTop: 8, fontSize: 11, color: "#8B949E" }}>
                  AC5 측 ransomware probability: <code style={{ color: "#79C0FF" }}>{lr.replace("lr_max_proba=", "")}</code>
                </div>
              ) : null;
            })()}

            <div style={{ ...LABEL, marginTop: 12 }}>EVIDENCE</div>
            <ul style={{ margin: "4px 0 0 18px", padding: 0, color: "#C9D1D9" }}>
              {verdictForNode.evidence.map((e, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  {e}
                </li>
              ))}
            </ul>

            <div style={{ ...LABEL, marginTop: 12 }}>MODEL</div>
            <div style={VAL}>{verdictForNode.model_version}</div>
          </>
        )}
      </div>

      <div style={{ marginTop: 24, paddingTop: 12, borderTop: "1px solid #1E2936" }}>
        <BlockButton
          pid={pid}
          onBlocked={(outcome) => onBlocked(pid, outcome)}
          disabled={isKilled}
        />
        <button
          onClick={() => void allow(pid)}
          disabled={isKilled}
          style={{
            background: "#121821",
            border: "1px solid #1E2936",
            color: "#E6EDF3",
            fontFamily: "inherit",
            fontSize: 13,
            padding: "12px 16px",
            borderRadius: 10,
            cursor: isKilled ? "not-allowed" : "pointer",
            opacity: isKilled ? 0.5 : 1,
            transition: "all 0.2s ease",
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
    <div
      style={{
        marginTop: 12,

        padding: 12,

        background: "#121821",

        border: "1px solid #1E2936",

        borderRadius: 10,
      }}
    >
      <div style={LABEL}>{label}</div>
      <div style={{ ...VAL, color: valueColor ?? "#E6EDF3" }}>{value}</div>
    </div>
  );
}
