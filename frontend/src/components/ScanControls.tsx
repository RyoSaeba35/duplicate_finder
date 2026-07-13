import { ScanProgress, formatBytes } from "../api";

interface Props {
  path: string;
  onPathChange: (p: string) => void;
  scanning: boolean;
  progress: ScanProgress | null;
  reclaimableBytes: number;
  onStart: () => void;
  onCancel: () => void;
}

// Only a real, literal path belongs here — no %USERNAME%-style
// placeholders, since the app opens paths directly rather than through a
// shell that would expand them. Everything else (Downloads, Pictures, any
// folder) should go through the native folder-picker dialog below instead.
const WHOLE_DRIVE = { label: "C:\\ (whole drive)", value: "C:\\" };

async function pickFolder(): Promise<string | null> {
  try {
    // Dynamic import so this file still loads fine in the plain-browser
    // dev preview (npm run dev in a regular tab) where the Tauri APIs
    // aren't injected — it'll only actually be called from inside the
    // real desktop app.
    const { open } = await import("@tauri-apps/api/dialog");
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  } catch {
    alert(
      "The folder picker only works inside the installed desktop app, not the browser preview. Type the path manually here instead."
    );
    return null;
  }
}

export default function ScanControls({
  path,
  onPathChange,
  scanning,
  progress,
  reclaimableBytes,
  onStart,
  onCancel,
}: Props) {
  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        padding: "14px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder="C:\ or a specific folder to scan"
          disabled={scanning}
          className="mono"
          style={{
            flex: 1,
            background: "var(--bg-panel-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--text-primary)",
            padding: "8px 10px",
          }}
        />
        <button
          onClick={async () => {
            const selected = await pickFolder();
            if (selected) onPathChange(selected);
          }}
          disabled={scanning}
          style={{
            background: "var(--bg-panel-raised)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "8px 14px",
            whiteSpace: "nowrap",
          }}
        >
          Browse…
        </button>
        {!scanning ? (
          <button
            onClick={onStart}
            disabled={!path}
            style={{
              background: "var(--accent-teal)",
              color: "#08201e",
              border: "none",
              borderRadius: "var(--radius)",
              padding: "8px 16px",
              fontWeight: 600,
            }}
          >
            Scan
          </button>
        ) : (
          <button
            onClick={onCancel}
            style={{
              background: "transparent",
              color: "var(--accent-danger)",
              border: "1px solid var(--accent-danger-dim)",
              borderRadius: "var(--radius)",
              padding: "8px 16px",
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => onPathChange(WHOLE_DRIVE.value)}
          disabled={scanning}
          style={{
            background: "transparent",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "4px 10px",
            fontSize: 12,
          }}
        >
          {WHOLE_DRIVE.label}
        </button>
      </div>

      {progress && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 4,
          }}
        >
          <span className="mono" style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
            {progress.status === "running"
              ? `scanning… ${progress.files_seen.toLocaleString()} files seen, ${progress.files_hashed.toLocaleString()} hashed`
              : progress.status === "done"
              ? `done — ${progress.files_seen.toLocaleString()} files scanned`
              : progress.status === "error"
              ? `error: ${progress.error_message}`
              : "cancelled"}
          </span>

          {/* Signature element: reclaimable space ticks up live as duplicate
              groups are confirmed, giving immediate payoff during a scan
              that can otherwise take minutes on a full C:\ drive. */}
          <span
            className="mono"
            style={{
              color: reclaimableBytes > 0 ? "var(--accent-teal)" : "var(--text-tertiary)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {formatBytes(reclaimableBytes)} reclaimable
          </span>
        </div>
      )}
    </div>
  );
}
