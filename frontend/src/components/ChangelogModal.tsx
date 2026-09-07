// ChangelogModal.tsx — shown automatically on the first launch after an update.
// Displays only the entries newer than the version the user last ran.

import { useEffect } from "react";
import { ChangelogEntry } from "../changelog";

interface Props {
  entries: ChangelogEntry[];
  currentVersion: string;
  onClose: () => void;
}

export default function ChangelogModal({ entries, currentVersion, onClose }: Props) {
  // Close on Escape.
  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 300, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", width: "100%", maxWidth: 500,
          maxHeight: "80vh", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "18px 20px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
              What's new
            </div>
            <div className="mono" style={{ fontSize: 12, color: "var(--accent-teal)", marginTop: 3 }}>
              v{currentVersion}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", color: "var(--text-tertiary)",
              width: 28, height: 28, fontSize: 14, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        {/* Entries */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
          {entries.map((entry, i) => (
            <div key={entry.version} style={{ marginBottom: i < entries.length - 1 ? 20 : 0 }}>
              {/* Only show version label when multiple entries are shown */}
              {entries.length > 1 && (
                <div className="mono" style={{
                  fontSize: 11, color: "var(--text-tertiary)",
                  textTransform: "uppercase", letterSpacing: 0.4,
                  marginBottom: 8,
                }}>
                  v{entry.version}
                </div>
              )}
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                {entry.highlights.map((item: string, j: number) => (
                  <li key={j} style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px",
          borderTop: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              width: "100%", background: "var(--accent-teal)", color: "#08201e",
              border: "none", borderRadius: "var(--radius)",
              padding: "9px", fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
