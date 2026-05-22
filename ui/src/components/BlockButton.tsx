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
        background: isDisabled ? "#660000" : "#ff3333",
        color: "#fff",
        fontFamily: "inherit",
        fontSize: 13,
        padding: "10px 18px",
        border: "none",
        borderRadius: 3,
        cursor: isDisabled ? "not-allowed" : "pointer",
        marginRight: 8,
        letterSpacing: 0.5,
      }}
      onMouseEnter={(e) => {
        if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.background = "#ff5555";
      }}
      onMouseLeave={(e) => {
        if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.background = "#ff3333";
      }}
    >
      {busy ? "차단 중..." : `BLOCK pid ${pid}`}
    </button>
  );
}
