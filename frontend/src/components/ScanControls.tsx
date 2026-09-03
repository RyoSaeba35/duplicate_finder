import { useRef } from "react";
import { ScanProgress, ScanOptions, formatBytes } from "../api";
import LanguageSwitcher from "./LanguageSwitcher";
import SettingsPanel from "./SettingsPanel";
import { useTranslation } from "../i18n/context";
import type { TranslationKey } from "../i18n/locales/en";
import { useState } from "react";

const MIN_SIZE_OPTIONS = [
  { value: 1,     label: "1 KB" },
  { value: 10,    label: "10 KB" },
  { value: 100,   label: "100 KB" },
  { value: 500,   label: "500 KB" },
  { value: 1024,  label: "1 MB" },
  { value: 10240, label: "10 MB" },
];

function parseExtensions(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith(".") ? s : `.${s}`));
}

// Formats a duration in seconds to a human-readable string.
// e.g. 45 → "~45s", 150 → "~2m 30s", 3600 → "~60m"
function formatEta(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 5 ? `~${m}m ${s}s` : `~${m}m`;
}

interface Props {
  path: string;
  onPathChange: (p: string) => void;
  scanning: boolean;
  progress: ScanProgress | null;
  reclaimableBytes: number;
  selectedCount: number;
  selectedBytes: number;
  minSizeKb: number;
  onMinSizeKbChange: (v: number) => void;
  onStart: () => void;
  onCancel: () => void;
  scanOptions: ScanOptions;
  onScanOptionsChange: (options: ScanOptions) => void;
}

const WHOLE_DRIVE_VALUE = "C:\\";

async function pickFolder(t: (key: TranslationKey) => string): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/api/dialog");
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  } catch {
    alert(t("scanControls.folderPickerError"));
    return null;
  }
}

export default function ScanControls({
  path, onPathChange, scanning, progress, reclaimableBytes,
  selectedCount, selectedBytes, minSizeKb, onMinSizeKbChange,
  onStart, onCancel, scanOptions, onScanOptionsChange,
}: Props) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [extFilterText, setExtFilterText] = useState(
    (scanOptions.extensionFilter ?? []).join(" ")
  );
  const { t } = useTranslation();

  // ── ETA tracking ────────────────────────────────────────────────────────────
  // hashPhaseStartRef is set the first time we see candidates > 0 with
  // files_hashed === 0 — that's the instant hashing begins. Rate and ETA
  // are computed from that point on every render so they update live.
  const hashPhaseStartRef = useRef<number | null>(null);

  // Capture the start of the hashing phase.
  if (
    progress?.status === "running" &&
    progress.candidates > 0 &&
    progress.files_hashed === 0 &&
    hashPhaseStartRef.current === null
  ) {
    hashPhaseStartRef.current = Date.now();
  }

  // Reset when a scan ends or a new one starts.
  if (!progress || progress.status !== "running") {
    hashPhaseStartRef.current = null;
  }

  // Compute ETA — only once enough data exists (> 1s elapsed, > 0 hashed).
  let etaText: string | null = null;
  if (
    progress?.status === "running" &&
    progress.files_hashed > 0 &&
    progress.candidates > progress.files_hashed &&
    hashPhaseStartRef.current !== null
  ) {
    const elapsedSec = (Date.now() - hashPhaseStartRef.current) / 1000;
    if (elapsedSec > 1) {
      const rate = progress.files_hashed / elapsedSec; // files per second
      if (rate > 0) {
        const remainingSec = Math.round(
          (progress.candidates - progress.files_hashed) / rate
        );
        // Only show when > 5s remaining to avoid flicker at the end.
        if (remainingSec > 5) {
          etaText = `${formatEta(remainingSec)} ${t("scanControls.etaRemaining")}`;
        }
      }
    }
  }

  function handleExtFilterChange(raw: string) {
    setExtFilterText(raw);
    onScanOptionsChange({ ...scanOptions, extensionFilter: parseExtensions(raw) });
  }

  return (
    <div style={{
      borderBottom: "1px solid var(--border)",
      background: "var(--bg-panel)",
      padding: "14px 20px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      {/* ── Top row ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder={t("scanControls.pathPlaceholder")}
          disabled={scanning}
          className="mono"
          style={{
            flex: 1, background: "var(--bg-panel-raised)",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            color: "var(--text-primary)", padding: "8px 10px",
          }}
        />
        <button
          onClick={async () => {
            const selected = await pickFolder(t);
            if (selected) onPathChange(selected);
          }}
          disabled={scanning}
          style={{
            background: "var(--bg-panel-raised)", color: "var(--text-primary)",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            padding: "8px 14px", whiteSpace: "nowrap",
          }}
        >
          {t("scanControls.browse")}
        </button>
        {!scanning ? (
          <button
            onClick={onStart}
            disabled={!path}
            style={{
              background: "var(--accent-teal)", color: "#08201e",
              border: "none", borderRadius: "var(--radius)",
              padding: "8px 16px", fontWeight: 600,
            }}
          >
            {t("scanControls.scan")}
          </button>
        ) : (
          <button
            onClick={onCancel}
            style={{
              background: "transparent", color: "var(--accent-danger)",
              border: "1px solid var(--accent-danger-dim)",
              borderRadius: "var(--radius)", padding: "8px 16px", fontWeight: 600,
            }}
          >
            {t("scanControls.cancel")}
          </button>
        )}
        <LanguageSwitcher />
        <SettingsPanel />
      </div>

      {/* ── Second row ── */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={() => onPathChange(WHOLE_DRIVE_VALUE)}
          disabled={scanning}
          style={{
            background: "transparent", color: "var(--text-secondary)",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            padding: "4px 10px", fontSize: 12,
          }}
        >
          {t("scanControls.wholeDrive")}
        </button>
        <button
          onClick={() => setOptionsOpen((v) => !v)}
          disabled={scanning}
          style={{
            background: "transparent", color: "var(--text-secondary)",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            padding: "4px 10px", fontSize: 12,
          }}
        >
          {optionsOpen ? t("scanControls.optionsOpen") : t("scanControls.optionsClosed")}
        </button>
      </div>

      {optionsOpen && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 8,
          background: "var(--bg-panel-raised)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", padding: "10px 14px",
        }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox"
              checked={scanOptions.skipHiddenSystem ?? true} disabled={scanning}
              onChange={(e) => onScanOptionsChange({ ...scanOptions, skipHiddenSystem: e.target.checked })}
            />
            {t("scanControls.skipHiddenSystem")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox"
              checked={scanOptions.skipSystemFolders ?? true} disabled={scanning}
              onChange={(e) => onScanOptionsChange({ ...scanOptions, skipSystemFolders: e.target.checked })}
            />
            {t("scanControls.skipSystemFolders")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox"
              checked={scanOptions.skipDevNoise ?? true} disabled={scanning}
              onChange={(e) => onScanOptionsChange({ ...scanOptions, skipDevNoise: e.target.checked })}
            />
            {t("scanControls.skipDevNoise")}
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ color: "var(--text-primary)", whiteSpace: "nowrap" }}>
              {t("scanControls.minSize")}
            </span>
            <select
              value={minSizeKb} disabled={scanning}
              onChange={(e) => onMinSizeKbChange(Number(e.target.value))}
              style={{
                background: "var(--bg-panel)", border: "1px solid var(--border)",
                borderRadius: "var(--radius)", color: "var(--text-secondary)",
                padding: "3px 6px", fontSize: 12,
              }}
            >
              {MIN_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ color: "var(--text-primary)", whiteSpace: "nowrap" }}>
              {t("scanControls.extensionFilter")}
            </span>
            <input
              type="text"
              value={extFilterText} disabled={scanning}
              onChange={(e) => handleExtFilterChange(e.target.value)}
              placeholder={t("scanControls.extensionFilterPlaceholder")}
              className="mono"
              style={{
                flex: 1, background: "var(--bg-panel)",
                border: "1px solid var(--border)", borderRadius: "var(--radius)",
                color: "var(--text-primary)", padding: "4px 8px", fontSize: 12,
              }}
            />
          </div>
        </div>
      )}

      {/* ── Progress ── */}
      {progress && (
        <>
          <div style={{
            display: "flex", justifyContent: "space-between",
            alignItems: "center", marginTop: 4,
          }}>
            {/* Left: status + ETA */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="mono" style={{
                color: "var(--text-secondary)", fontSize: 13,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {progress.status === "running" && (
                  <span className="spinner" aria-hidden="true" />
                )}
                {progress.status === "running"
                  ? t("scanControls.scanning", {
                      seen: progress.files_seen.toLocaleString(),
                      hashed: progress.files_hashed.toLocaleString(),
                    })
                  : progress.status === "done"
                  ? t("scanControls.done", { count: progress.files_seen.toLocaleString() })
                  : progress.status === "error"
                  ? t("scanControls.error", { message: progress.error_message })
                  : t("scanControls.cancelled")}
              </span>

              {/* ETA — shown once we have a meaningful estimate */}
              {etaText && (
                <span className="mono" style={{
                  fontSize: 12,
                  color: "var(--text-tertiary)",
                }}>
                  {etaText}
                </span>
              )}
            </div>

            {/* Right: marked counter + reclaimable */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {selectedCount > 0 && (
                <span className="mono" style={{
                  fontSize: 13, color: "var(--accent-danger)", fontWeight: 600,
                }}>
                  {t("scanControls.markedCounter", {
                    count: selectedCount,
                    size: formatBytes(selectedBytes),
                  })}
                </span>
              )}
              <span className="mono" style={{
                color: reclaimableBytes > 0 ? "var(--accent-teal)" : "var(--text-tertiary)",
                fontSize: 13, fontWeight: 600,
              }}>
                {t("scanControls.reclaimable", { amount: formatBytes(reclaimableBytes) })}
              </span>
            </div>
          </div>

          {progress.status === "running" && (
            <div className="scanProgressBar" role="progressbar"
              aria-label={t("scanControls.scanningAriaLabel")}>
              <div className="scanProgressBar__fill" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
