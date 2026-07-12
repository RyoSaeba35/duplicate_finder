import { DuplicateGroup, FileEntry, formatBytes } from "../api";

interface Props {
  group: DuplicateGroup | null;
  keepPath: string | null;
  onSetKeep: (path: string) => void;
  selectedForDeletion: Set<string>;
  onToggleSelect: (path: string) => void;
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

      <div style={{ fontSize: 14, fontWeight: 600, wordBreak: "break-word" }}>
        {file.filename}
      </div>

      <div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)", wordBreak: "break-all" }}>
        {file.path}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-secondary)" }}>
        <span>{formatBytes(file.size_bytes)}</span>
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
