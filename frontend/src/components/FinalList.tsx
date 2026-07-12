import { useState } from "react";
import { formatBytes } from "../api";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

interface Props {
  selectedPaths: string[];
  selectedBytes: number;
  onDelete: () => Promise<void>;
  onDeselect: (path: string) => void;
}

export default function FinalList({ selectedPaths, selectedBytes, onDelete, onDeselect }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (selectedPaths.length === 0) return null;

  async function handleConfirm() {
    setDeleting(true);
    try {
      await onDelete();
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "transparent",
          border: "none",
          color: "var(--text-primary)",
          padding: "10px 20px",
        }}
      >
        <span style={{ fontSize: 12 }}>
          {selectedPaths.length} file{selectedPaths.length > 1 ? "s" : ""} marked for the trash —{" "}
          <span className="mono" style={{ color: "var(--accent-danger)" }}>
            {formatBytes(selectedBytes)}
          </span>
        </span>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{open ? "hide list ▾" : "show list ▸"}</span>
      </button>

      {open && (
        <div style={{ maxHeight: 180, overflowY: "auto", padding: "0 20px" }}>
          {selectedPaths.map((p) => (
            <div
              key={p}
              className="mono"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 11,
                color: "var(--text-secondary)",
                padding: "4px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
              <button
                onClick={() => onDeselect(p)}
                style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", flexShrink: 0 }}
              >
                remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "12px 20px" }}>
        <button
          onClick={() => setConfirmOpen(true)}
          style={{
            width: "100%",
            background: "var(--accent-danger)",
            color: "#2a0d06",
            border: "none",
            borderRadius: "var(--radius)",
            padding: "10px",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {`Move ${selectedPaths.length} file${selectedPaths.length > 1 ? "s" : ""} to Trash (${formatBytes(selectedBytes)})`}
        </button>
      </div>

      {confirmOpen && (
        <ConfirmDeleteModal
          fileCount={selectedPaths.length}
          totalBytes={selectedBytes}
          busy={deleting}
          onCancel={() => !deleting && setConfirmOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
