import { formatBytes } from "../api";
import { useTranslation } from "../i18n/context";

interface Props {
  fileCount: number;
  totalBytes: number;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}

export default function ConfirmDeleteModal({ fileCount, totalBytes, onConfirm, onCancel, busy }: Props) {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          width: 380,
          padding: 22,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        <h2 id="confirm-delete-title" style={{ margin: "0 0 8px", fontSize: 15 }}>
          {t("confirmDeleteModal.title", { count: fileCount })}
        </h2>
        <p style={{ margin: "0 0 4px", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {t("confirmDeleteModal.description", { size: formatBytes(totalBytes) })}
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              borderRadius: "var(--radius)",
              padding: "9px 0",
            }}
          >
            {t("confirmDeleteModal.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            style={{
              flex: 1,
              background: "var(--accent-danger)",
              border: "none",
              color: "#2a0d06",
              fontWeight: 700,
              borderRadius: "var(--radius)",
              padding: "9px 0",
            }}
          >
            {busy ? t("confirmDeleteModal.moving") : t("confirmDeleteModal.moveToTrash")}
          </button>
        </div>
      </div>
    </div>
  );
}
