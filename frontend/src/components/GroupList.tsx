import { useEffect, useState } from "react";
import { DuplicateGroup, formatBytes } from "../api";
import { useTranslation } from "../i18n/context";
import { useAppMode } from "./LicenseGate";

export type BulkRule = "newest" | "oldest" | "shortest";

const BUY_URL = "https://pierrecode.gumroad.com/l/byzsj";

interface Props {
  groups: DuplicateGroup[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  onBulkSelect: (rule: BulkRule) => void;
  // Reports the current sorted+filtered hash order to App so keyboard
  // navigation stays in sync with what's visible in the sidebar.
  onSortedHashes?: (hashes: string[]) => void;
}

type SortBy = "wasted" | "count" | "name";

function exportCsv(groups: DuplicateGroup[]): void {
  const rows = ["Group ID,Status,Filename,Path,Size (bytes),Modified"];
  for (const group of groups) {
    const keepPath = group.files[0]?.path ?? "";
    for (const file of group.files) {
      const status = file.path === keepPath ? "KEEP" : "DUPLICATE";
      const modified = file.modified_unix
        ? new Date(file.modified_unix * 1000).toISOString() : "";
      const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
      rows.push([group.hash.slice(0, 8), status, q(file.filename),
        q(file.path), file.size_bytes, modified].join(","));
    }
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `duplicate-finder-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function GroupList({
  groups, selectedHash, onSelect, onBulkSelect, onSortedHashes,
}: Props) {
  const { t } = useTranslation();
  const { isFreeMode } = useAppMode();
  const [filterText, setFilterText] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("wasted");
  const [bulkRule, setBulkRule] = useState<BulkRule>("newest");

  const filtered = filterText.trim()
    ? groups.filter((g) => {
        const q = filterText.toLowerCase();
        return g.files.some(
          (f) => f.filename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
        );
      })
    : groups;

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case "wasted": return b.wasted_bytes - a.wasted_bytes;
      case "count":  return b.files.length - a.files.length;
      case "name": {
        const aName = (a.files[0]?.filename ?? "").toLowerCase();
        const bName = (b.files[0]?.filename ?? "").toLowerCase();
        return aName.localeCompare(bName);
      }
      default: return 0;
    }
  });

  // Report sorted hashes to App after every sort/filter change so keyboard
  // navigation is always in sync with what's visible in the sidebar.
  useEffect(() => {
    onSortedHashes?.(sorted.map((g) => g.hash));
  }, [sorted, onSortedHashes]);

  return (
    <div style={{
      width: 260, borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      background: "var(--bg-panel)", overflow: "hidden",
    }}>
      {/* Filter + sort */}
      <div style={{
        padding: "10px 10px 8px", borderBottom: "1px solid var(--border)",
        display: "flex", flexDirection: "column", gap: 7, flexShrink: 0,
      }}>
        <input
          type="search" value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder={t("groupList.filterPlaceholder")}
          style={{
            background: "var(--bg-panel-raised)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", color: "var(--text-primary)",
            padding: "6px 8px", fontSize: 12, width: "100%",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-tertiary)" }}>
            {t("groupList.duplicateSetsLabel", { count: sorted.length })}
          </span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}
            style={{
              background: "transparent", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", color: "var(--text-secondary)",
              padding: "3px 6px", fontSize: 11,
            }}>
            <option value="wasted">{t("groupList.sortWasted")}</option>
            <option value="count">{t("groupList.sortCount")}</option>
            <option value="name">{t("groupList.sortName")}</option>
          </select>
        </div>
      </div>

      {/* Bulk select + export */}
      {groups.length > 0 && (
        <div style={{
          padding: "8px 10px", borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel-raised)", display: "flex",
          flexDirection: "column", gap: 6, flexShrink: 0,
        }}>
          {isFreeMode ? (
            <a href={BUY_URL} target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 5,
                fontSize: 12, color: "var(--text-tertiary)", textDecoration: "none" }}>
              <span>🔒</span>{t("groupList.bulkSelectLocked")}
            </a>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select value={bulkRule} onChange={(e) => setBulkRule(e.target.value as BulkRule)}
                style={{
                  flex: 1, background: "var(--bg-panel)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius)", color: "var(--text-secondary)",
                  padding: "4px 6px", fontSize: 11,
                }}>
                <option value="newest">{t("groupList.ruleNewest")}</option>
                <option value="oldest">{t("groupList.ruleOldest")}</option>
                <option value="shortest">{t("groupList.ruleShortest")}</option>
              </select>
              <button onClick={() => onBulkSelect(bulkRule)} style={{
                background: "var(--accent-teal)", border: "none",
                borderRadius: "var(--radius)", color: "var(--bg-base)",
                fontSize: 11, fontWeight: 700, padding: "4px 8px",
                whiteSpace: "nowrap", flexShrink: 0,
              }}>
                {t("groupList.applyToAll")}
              </button>
            </div>
          )}
          <button onClick={() => exportCsv(groups)} style={{
            background: "transparent", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", color: "var(--text-secondary)",
            fontSize: 11, padding: "4px 8px", width: "100%", textAlign: "center",
          }}>
            {t("groupList.exportCsv")}
          </button>
        </div>
      )}

      {/* List */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {sorted.map((g) => {
          const isSelected = g.hash === selectedHash;
          const thumbFile = g.files.find((f) => f.is_image) ?? g.files[0];
          return (
            <button key={g.hash} onClick={() => onSelect(g.hash)} style={{
              display: "block", width: "100%", textAlign: "left",
              background: isSelected ? "var(--bg-panel-raised)" : "transparent",
              border: "none", borderBottom: "1px solid var(--border)",
              borderLeft: isSelected ? "2px solid var(--accent-teal)" : "2px solid transparent",
              padding: "10px 14px", color: "var(--text-primary)",
            }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
                {thumbFile.filename}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 12, color: "var(--text-secondary)" }}>
                <span>{t("groupList.copiesLabel", { count: g.files.length })}</span>
                <span className="mono">{t("groupList.wastedLabel", { amount: formatBytes(g.wasted_bytes) })}</span>
              </div>
            </button>
          );
        })}
        {sorted.length === 0 && groups.length > 0 && (
          <div style={{ padding: 14, color: "var(--text-tertiary)", fontSize: 12 }}>
            {t("groupList.noResults")}
          </div>
        )}
        {groups.length === 0 && (
          <div style={{ padding: 14, color: "var(--text-tertiary)", fontSize: 12 }}>
            {t("groupList.noDuplicatesYet")}
          </div>
        )}
      </div>
    </div>
  );
}
