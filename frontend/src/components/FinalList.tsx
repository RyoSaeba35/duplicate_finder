import { useEffect, useState } from "react";
import { FileEntry, formatBytes, formatModifiedDate } from "../api";
import { TextPreview } from "./FilePreview";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import { useTranslation } from "../i18n/context";
import { useAppMode } from "./LicenseGate";

const BUY_URL = "https://getduplicatefinder.app/buy";
const PREVIEW_HEIGHT = 300;

function usePreviewUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { convertFileSrc } = await import("@tauri-apps/api/tauri");
        if (!cancelled) setUrl(convertFileSrc(path));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [path]);
  return url;
}

function InlinePreview({ file }: { file: FileEntry }) {
  const url = usePreviewUrl(file.path);

  if (!url) {
    return (
      <div style={{
        height: PREVIEW_HEIGHT, display: "flex",
        alignItems: "center", justifyContent: "center",
      }}>
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  }

  if (file.is_image) {
    return (
      <img
        src={url}
        alt={file.filename}
        style={{
          width: "100%", height: PREVIEW_HEIGHT, objectFit: "contain",
          borderRadius: "var(--radius)", background: "var(--bg-base)",
        }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    );
  }

  if (file.extension === ".pdf") {
    return (
      <iframe
        src={url}
        title={file.filename}
        style={{
          width: "100%", height: PREVIEW_HEIGHT, border: "none",
          borderRadius: "var(--radius)", background: "var(--bg-base)",
        }}
      />
    );
  }

  if (file.is_text && file.size_bytes < 2 * 1024 * 1024) {
    return (
      <div style={{ height: PREVIEW_HEIGHT }}>
        <TextPreview url={url} extension={file.extension} />
      </div>
    );
  }

  return (
    <div style={{
      height: PREVIEW_HEIGHT, display: "flex",
      alignItems: "center", justifyContent: "center",
      background: "var(--bg-base)", borderRadius: "var(--radius)",
    }}>
      <span className="mono" style={{
        fontSize: 22, fontWeight: 700, letterSpacing: 1,
        color: "var(--text-tertiary)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", padding: "10px 18px",
      }}>
        {(file.extension || "file").replace(".", "").toUpperCase()}
      </span>
    </div>
  );
}

interface ReviewModalProps {
  selectedFiles: FileEntry[];
  selectedBytes: number;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onDeselect: (path: string) => void;
}

function ReviewModal({
  selectedFiles, selectedBytes, onClose, onDelete, onDeselect,
}: ReviewModalProps) {
  const { t } = useTranslation();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function togglePreview(path: string) {
    setOpenPath((prev) => (prev === path ? null : path));
  }

  async function handleConfirm() {
    setDeleting(true);
    try {
      await onDelete();
      setConfirmOpen(false);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
    >
      <div style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        width: "100%",
        maxWidth: 860,
        height: "90vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>

        {/* Header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <h2 id="review-modal-title" style={{ margin: 0, fontSize: 15, color: "var(--text-primary)" }}>
              {t("finalList.reviewTitle", { count: selectedFiles.length })}
            </h2>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              {formatBytes(selectedBytes)} {t("finalList.reviewWillFree")}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", color: "var(--text-secondary)",
              padding: "6px 14px", fontSize: 13,
            }}
          >
            {t("finalList.reviewClose")}
          </button>
        </div>

        {/* File list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {selectedFiles.map((file) => {
            const isOpen = openPath === file.path;
            return (
              <div key={file.path} style={{ borderBottom: "1px solid var(--border)" }}>
                <div
                  onClick={() => togglePreview(file.path)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "10px 20px",
                    cursor: "pointer",
                    background: isOpen ? "var(--bg-panel-raised)" : "transparent",
                    gap: 10,
                  }}
                >
                  <span style={{
                    fontSize: 11, color: "var(--text-tertiary)",
                    flexShrink: 0, width: 10,
                  }}>
                    {isOpen ? "▾" : "▸"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {file.filename}
                    </div>
                    <div className="mono" style={{
                      fontSize: 11, color: "var(--text-tertiary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      marginTop: 2,
                    }}>
                      {file.path}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {formatBytes(file.size_bytes)}
                    </span>
                    {formatModifiedDate(file.modified_unix) && (
                      <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        {formatModifiedDate(file.modified_unix)}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (openPath === file.path) setOpenPath(null);
                        onDeselect(file.path);
                      }}
                      title={t("finalList.remove")}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        color: "var(--text-tertiary)",
                        padding: "2px 8px",
                        fontSize: 14, lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div style={{ padding: "0 20px 16px", background: "var(--bg-panel-raised)" }}>
                    <InlinePreview file={file} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: 10,
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              background: "transparent", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", color: "var(--text-primary)",
              padding: "10px", fontSize: 13,
            }}
          >
            {t("confirmDeleteModal.cancel")}
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            style={{
              flex: 2,
              background: "var(--accent-danger)", border: "none",
              borderRadius: "var(--radius)", color: "#2a0d06",
              fontWeight: 700, padding: "10px", fontSize: 13,
            }}
          >
            {t("finalList.moveToTrash", {
              count: selectedFiles.length,
              size: formatBytes(selectedBytes),
            })}
          </button>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmDeleteModal
          fileCount={selectedFiles.length}
          totalBytes={selectedBytes}
          busy={deleting}
          onCancel={() => !deleting && setConfirmOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}

// ── Bottom trigger bar ────────────────────────────────────────────────────────

interface Props {
  selectedFiles: FileEntry[];
  selectedBytes: number;
  onDelete: () => Promise<void>;
  onDeselect: (path: string) => void;
}

export default function FinalList({
  selectedFiles, selectedBytes, onDelete, onDeselect,
}: Props) {
  const { t } = useTranslation();
  const { isFreeMode } = useAppMode();
  const [reviewOpen, setReviewOpen] = useState(false);

  if (selectedFiles.length === 0) return null;

  return (
    <>
      <div style={{
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
        flexShrink: 0,
      }}>
        {/* Count row */}
        <div style={{
          padding: "10px 20px 0",
          fontSize: 12,
          color: "var(--text-secondary)",
        }}>
          {t("finalList.filesMarkedForTrash", { count: selectedFiles.length })}{" "}
          <span className="mono" style={{ color: "var(--accent-danger)" }}>
            {formatBytes(selectedBytes)}
          </span>
        </div>

        {/* Full-width button */}
        <div style={{ padding: "10px 20px 14px" }}>
          {isFreeMode ? (
            <a
              href={BUY_URL}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, width: "100%", background: "var(--bg-panel-raised)",
                border: "1px solid var(--border)", borderRadius: "var(--radius)",
                color: "var(--accent-teal)", fontWeight: 700, fontSize: 13,
                padding: "10px", textDecoration: "none",
              }}
            >
              <span>🔒</span>
              {t("licenseGate.freeModeUpgrade")}
            </a>
          ) : (
            <button
              onClick={() => setReviewOpen(true)}
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
              {t("finalList.reviewButton", {
                count: selectedFiles.length,
                size: formatBytes(selectedBytes),
              })}
            </button>
          )}
        </div>
      </div>

      {reviewOpen && (
        <ReviewModal
          selectedFiles={selectedFiles}
          selectedBytes={selectedBytes}
          onClose={() => setReviewOpen(false)}
          onDelete={onDelete}
          onDeselect={onDeselect}
        />
      )}
    </>
  );
}
