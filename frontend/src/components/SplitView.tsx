import { DuplicateGroup, FileEntry, formatBytes, formatModifiedDate } from "../api";

interface Props {
  group: DuplicateGroup | null;
  keepPath: string | null;
  onSetKeep: (path: string) => void;
  selectedForDeletion: Set<string>;
  onToggleSelect: (path: string) => void;
}

const PREVIEW_BASE_URL = "http://127.0.0.1:8721/files/preview";

// Bumped up from the original 180px, then 280px, per feedback that the
// preview felt cramped — this is roughly half a typical laptop screen's
// height, enough to actually read a PDF page or judge a photo without
// needing to open it separately.
const PREVIEW_HEIGHT = 480;

// Opens a file with the OS's default application (e.g. an image viewer,
// PDF reader, whatever the user has associated with that file type).
// Dynamic import for the same reason as the folder picker in
// ScanControls.tsx: this file still loads fine in the plain-browser dev
// preview, where the Tauri shell API isn't injected — it only actually
// gets called from inside the real desktop app.
async function openFile(path: string) {
  let openFn: (path: string) => Promise<void>;
  try {
    ({ open: openFn } = await import("@tauri-apps/api/shell"));
  } catch {
    alert(
      "Opening files only works inside the installed desktop app, not the browser preview."
    );
    return;
  }
  try {
    await openFn(path);
  } catch (e) {
    // A real failure inside the actual app — show what Tauri actually
    // said instead of a generic message, so a permission/scope problem
    // (like the one that motivated this split) is visible and debuggable
    // rather than silently swallowed.
    alert(`Couldn't open this file: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function FileCard({
  file,
  role,
  onSetKeep,
  isSelected,
  onToggleSelect,
}: {
  file: FileEntry;
  role: "keep" | "duplicate";
  onSetKeep: () => void;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${role === "keep" ? "var(--accent-teal-dim)" : "var(--border)"}`,
        borderRadius: "var(--radius)",
        background: "var(--bg-panel-raised)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: role === "keep" ? "var(--accent-teal)" : "var(--text-secondary)",
            fontWeight: 700,
          }}
        >
          {role === "keep" ? "Keep" : "Duplicate"}
        </span>

        {role === "duplicate" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={isSelected} onChange={onToggleSelect} />
            mark for trash
          </label>
        )}
      </div>

      {file.is_image ? (
        <img
          src={`${PREVIEW_BASE_URL}?path=${encodeURIComponent(file.path)}`}
          alt={file.filename}
          style={{
            width: "100%",
            height: PREVIEW_HEIGHT,
            objectFit: "contain",
            borderRadius: "var(--radius)",
            background: "var(--bg-base)",
          }}
          // If the backend can't serve this one (too large, unreadable,
          // etc.) just hide the broken-image icon rather than showing it.
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : file.extension === ".pdf" ? (
        // WebView2 (the Windows webview Tauri uses) has the same
        // built-in PDF viewer Chrome does — an <iframe> pointed at a PDF
        // URL renders it directly, complete with its own zoom/scroll/page
        // controls, no extra rendering library needed.
        <iframe
          src={`${PREVIEW_BASE_URL}?path=${encodeURIComponent(file.path)}`}
          title={file.filename}
          style={{
            width: "100%",
            height: PREVIEW_HEIGHT,
            border: "none",
            borderRadius: "var(--radius)",
            background: "var(--bg-base)",
          }}
        />
      ) : (
        // No real preview for other types (videos, docs, archives — each
        // would need its own renderer, out of scope for now). A clear
        // file-type badge is a lightweight stand-in that still helps at
        // a glance; "open file" above covers actually viewing them.
        <div
          style={{
            width: "100%",
            height: PREVIEW_HEIGHT,
            borderRadius: "var(--radius)",
            background: "var(--bg-base)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 1,
              color: "var(--text-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "10px 18px",
            }}
          >
            {(file.extension || "file").replace(".", "").toUpperCase()}
          </span>
        </div>
      )}

      <div style={{ fontSize: 14, fontWeight: 600, wordBreak: "break-word" }}>
        {file.filename}
      </div>

      <div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)", wordBreak: "break-all" }}>
        {file.path}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--text-secondary)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>{formatBytes(file.size_bytes)}</span>
          {formatModifiedDate(file.modified_unix) && (
            <span className="mono" style={{ color: "var(--text-tertiary)" }}>
              {formatModifiedDate(file.modified_unix)}
            </span>
          )}
          <button
            onClick={() => openFile(file.path)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--accent-teal)",
              fontSize: 11,
              padding: 0,
            }}
          >
            open file ↗
          </button>
        </div>
        {role === "duplicate" && (
          <button
            onClick={onSetKeep}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--accent-teal)",
              fontSize: 11,
              padding: 0,
            }}
          >
            keep this one instead →
          </button>
        )}
      </div>
    </div>
  );
}

export default function SplitView({ group, keepPath, onSetKeep, selectedForDeletion, onToggleSelect }: Props) {
  if (!group) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-tertiary)",
        }}
      >
        Select a duplicate set on the left to compare files.
      </div>
    );
  }

  const keepFile = group.files.find((f) => f.path === keepPath) ?? group.files[0];
  const duplicates = group.files.filter((f) => f.path !== keepFile.path);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-tertiary)",
        }}
      >
        {group.files.length} identical files &middot; {formatBytes(group.size_bytes)} each &middot;{" "}
        <span style={{ color: "var(--accent-teal)" }}>{formatBytes(group.wasted_bytes)}</span> reclaimable
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left pane: the file being kept */}
        <div style={{ flex: 1, padding: 16, overflowY: "auto", borderRight: "1px solid var(--border)" }}>
          <FileCard
            file={keepFile}
            role="keep"
            onSetKeep={() => {}}
            isSelected={false}
            onToggleSelect={() => {}}
          />
        </div>

        {/* Right pane: every other duplicate location */}
        <div
          style={{
            flex: 1,
            padding: 16,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {duplicates.map((f) => (
            <FileCard
              key={f.path}
              file={f}
              role="duplicate"
              onSetKeep={() => onSetKeep(f.path)}
              isSelected={selectedForDeletion.has(f.path)}
              onToggleSelect={() => onToggleSelect(f.path)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
