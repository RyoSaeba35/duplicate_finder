// Toast.tsx — auto-dismissing notification shown after a batch delete.
// Appears centered above the bottom bar for 3 seconds then fades out.

import { useEffect, useState } from "react";
import { formatBytes } from "../api";
import { useTranslation } from "../i18n/context";

interface Props {
  count: number;
  bytes: number;
  onDone: () => void;
}

export default function Toast({ count, bytes, onDone }: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Start fade-out 400ms before removing
    const fadeTimer = setTimeout(() => setVisible(false), 2600);
    const doneTimer = setTimeout(onDone, 3000);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 90,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--bg-panel)",
        border: "1px solid var(--accent-teal-dim)",
        borderRadius: "var(--radius)",
        padding: "10px 20px",
        fontSize: 13,
        color: "var(--text-primary)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
        zIndex: 300,
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.4s ease",
        pointerEvents: "none",
      }}
    >
      <span style={{ color: "var(--accent-teal)", fontWeight: 700 }}>✓</span>
      {t("toast.filesDeleted", { count, size: formatBytes(bytes) })}
    </div>
  );
}
