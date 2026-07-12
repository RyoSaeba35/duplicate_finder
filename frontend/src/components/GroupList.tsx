import { DuplicateGroup, formatBytes } from "../api";

interface Props {
  groups: DuplicateGroup[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
}

export default function GroupList({ groups, selectedHash, onSelect }: Props) {
  const sorted = [...groups].sort((a, b) => b.wasted_bytes - a.wasted_bytes);

  return (
    <div
      style={{
        width: 260,
        borderRight: "1px solid var(--border)",
        overflowY: "auto",
        background: "var(--bg-panel)",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          color: "var(--text-tertiary)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {sorted.length} duplicate {sorted.length === 1 ? "set" : "sets"}
      </div>

      {sorted.map((g) => {
        const isSelected = g.hash === selectedHash;
        const thumbFile = g.files.find((f) => f.is_image) ?? g.files[0];
        return (
          <button
            key={g.hash}
            onClick={() => onSelect(g.hash)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: isSelected ? "var(--bg-panel-raised)" : "transparent",
              borderLeft: isSelected
                ? "2px solid var(--accent-teal)"
                : "2px solid transparent",
              border: "none",
              borderBottom: "1px solid var(--border)",
              padding: "10px 14px",
              color: "var(--text-primary)",
            }}
          >
            <div
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 13,
              }}
            >
              {thumbFile.filename}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 3,
                fontSize: 11,
                color: "var(--text-secondary)",
              }}
            >
              <span>{g.files.length} copies</span>
              <span className="mono">{formatBytes(g.wasted_bytes)} wasted</span>
            </div>
          </button>
        );
      })}

      {sorted.length === 0 && (
        <div style={{ padding: 14, color: "var(--text-tertiary)", fontSize: 12 }}>
          No duplicates found yet.
        </div>
      )}
    </div>
  );
}
