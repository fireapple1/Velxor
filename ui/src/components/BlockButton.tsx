import { useState } from "react";
import { block } from "../api/block";

type Props = {
  pid: number;
  onBlocked: (outcome: string) => void;
  disabled?: boolean;
};

export function BlockButton({ pid, onBlocked, disabled }: Props) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const { outcome } = await block(pid);
      onBlocked(outcome);
    } finally {
      setBusy(false);
    }
  };

  const isDisabled = busy || !!disabled;

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      style={{
        background: isDisabled
          ? "#2A1314"
          : "#3A1819",

        color: "#FF4D4F",

        fontFamily: "inherit",

        fontSize: 13,

        fontWeight: 600,

        padding: "12px 16px",

        border: "1px solid #FF4D4F",

        borderRadius: 10,

        cursor: isDisabled
          ? "not-allowed"
          : "pointer",

        marginRight: 8,

        letterSpacing: 0.3,

        opacity: isDisabled ? 0.5 : 1,

        transition:
          "background 0.2s ease, border-color 0.2s ease",
      }}
      onMouseEnter={(e) => {
        if (!isDisabled) {
          e.currentTarget.style.background = "#4A1F21";
        }
      }}

      onMouseLeave={(e) => {
        if (!isDisabled) {
          e.currentTarget.style.background = "#3A1819";
        }
      }}
    >
      {busy ? "차단 중..." : `TERMINATE PROCESS`}
    </button>
  );
}
