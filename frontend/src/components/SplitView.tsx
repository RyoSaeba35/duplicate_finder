import { useEffect, useState } from "react";
import { DuplicateGroup, FileEntry, formatBytes, formatModifiedDate } from "../api";
import { TextPreview, DocxPreview, XlsxPreview } from "./FilePreview";
import { useTranslation } from "../i18n/context";
import { useAppMode } from "./LicenseGate";
import type { TranslationKey } from "../i18n/locales/en";

const BUY_URL = "https://getduplicatefinder.app/buy";

interface Props {
  group: DuplicateGroup | null;
  keepPath: string | null;
  onSetKeep: (path: string) => void;
  selectedForDeletion: Set<string>;
  onToggleSelect: (path: string) => void;
}

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

const PREVIEW_HEIGHT = 480;
const TEXT_PREVIEW_MAX = 2 * 1024 * 1024;
const BINARY_PREVIEW_MAX = 20 * 1024 * 1024;
const PDF_LOAD_TIMEOUT_MS = 4000;

async function openFile(
  path: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
) {
  let openFn: (path: string) => Promise<void>;
  try {
    ({ open: openFn } = await import("@tauri-apps/api/shell"));
  } catch {
    alert(t("splitView.openFileOnlyInApp"));
    return;
  }
  try {
    await openFn(path);
  } catch (e) {
    alert(t("splitView.couldNotOpenFile", { message: e instanceof Error ? e.message : String(e) }));
  }
}

async function openFolder(
  path: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
) {
  // Derive the parent folder by stripping the filename.
  // Handles both backslash (Windows) and forward-slash separators.
  const sep = path.includes("\\") ? "\\" : "/";
  const folderPath = path.substring(0, path.lastIndexOf(sep)) || path;
  let openFn: (path: string) => Promise<void>;
  try {
    ({ open: openFn } = await import("@tauri-apps/api/shell"));
  } catch {
    alert(t("splitView.openFileOnlyInApp"));
    return;
  }
  try {
    await openFn(folderPath);
  } catch (e) {
    alert(t("splitView.couldNotOpenFile", { message: e instanceof Error ? e.message : String(e) }));
  }
}

function PreviewPlaceholder() {
  return (
    <div style={{
      width: "100%", height: PREVIEW_HEIGHT, borderRadius: "var(--radius)",
      background: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span className="spinner" aria-hidden="true" />
    </div>
  );
}

function PreviewError({ label, onRetry }: { label: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={{
      width: "100%", height: PREVIEW_HEIGHT, borderRadius: "var(--radius)",
      background: "var(--bg-base)", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12,
    }}>
      <span className="mono" style={{
        fontSize: 22, fontWeight: 700, letterSpacing: 1, color: "var(--text-tertiary)",
        border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 18px",
      }}>
        {label}
      </span>
      {onRetry && (
        <button onClick={onRetry} style={{
          background: "transparent", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", color: "var(--text-secondary)", fontSize: 12, padding: "5px 12px",
        }}>
          {t("splitView.retryPreview")}
        </button>
      )}
    </div>
  );
}

function PdfPreview({ url, filename }: { url: string; filename: string }) {
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setLoadState("loading");
    const timer = setTimeout(() => {
      setLoadState((prev) => (prev === "loading" ? "error" : prev));
    }, PDF_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [url, retryKey]);

  if (loadState === "error") {
    return <PreviewError label="PDF" onRetry={() => setRetryKey((k) => k + 1)} />;
  }

  return (
    <div style={{ position: "relative", width: "100%", height: PREVIEW_HEIGHT }}>
      {loadState === "loading" && (
        <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          <PreviewPlaceholder />
        </div>
      )}
      <iframe
        key={retryKey}
        src={url}
        title={filename}
        onLoad={() => setLoadState("loaded")}
        style={{
          width: "100%", height: PREVIEW_HEIGHT, border: "none",
          borderRadius: "var(--radius)", background: "var(--bg-base)",
          opacity: loadState === "loaded" ? 1 : 0,
          transition: "opacity 0.15s ease",
        }}
      />
    </div>
  );
}

function FileCard({
  file, role, onSetKeep, isSelected, onToggleSelect, previewDelay,
}: {
  file: FileEntry;
  role: "keep" | "duplicate";
  onSetKeep: () => void;
  isSelected: boolean;
  onToggleSelect: () => void;
  previewDelay: number;
}) {
  const previewUrl = usePreviewUrl(file.path);
  const sizeOk = file.is_text
    ? file.size_bytes <= TEXT_PREVIEW_MAX
    : file.size_bytes <= BINARY_PREVIEW_MAX;
  const { t } = useTranslation();
  const { isFreeMode } = useAppMode();

  const [previewReady, setPreviewReady] = useState(previewDelay === 0);
  useEffect(() => {
    if (previewDelay === 0) return;
    const timer = setTimeout(() => setPreviewReady(true), previewDelay);
    return () => clearTimeout(timer);
  }, [previewDelay]);

  return (
    <div style={{
      border: `1px solid ${role === "keep" ? "var(--accent-teal-dim)" : "var(--border)"}`,
      borderRadius: "var(--radius)", background: "var(--bg-panel-raised)",
      padding: 14, display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700,
            color: role === "keep" ? "var(--accent-teal)" : "var(--text-secondary)",
          }}>
            {role === "keep" ? t("splitView.keep") : t("splitView.duplicate")}
          </span>
          {role === "keep" && (
            <span
              title={t("splitView.keepTooltip")}
              aria-label={t("splitView.keepTooltip")}
              style={{ fontSize: 11, color: "var(--text-tertiary)", cursor: "help", lineHeight: 1, userSelect: "none" }}
            >
              ⓘ
            </span>
          )}
        </div>

        {role === "duplicate" && (
          isFreeMode ? (
            <a href={BUY_URL} target="_blank" rel="noreferrer"
              title={t("licenseGate.freeModeUpgrade")}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-tertiary)", textDecoration: "none" }}>
              <span aria-hidden="true">🔒</span>
              {t("licenseGate.freeModeMarkLocked")}
            </a>
          ) : (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={isSelected} onChange={onToggleSelect} />
              {t("splitView.markForTrash")}
            </label>
          )
        )}
      </div>

      <div style={{ position: "relative" }}>
        {!previewReady || !previewUrl ? (
          <PreviewPlaceholder />
        ) : file.is_image && sizeOk ? (
          <img src={previewUrl} alt={file.filename} style={{
            width: "100%", height: PREVIEW_HEIGHT, objectFit: "contain",
            borderRadius: "var(--radius)", background: "var(--bg-base)",
            transition: "filter 0.2s ease",
            filter: isSelected ? "grayscale(1) brightness(0.45)" : "none",
          }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        ) : file.extension === ".pdf" && sizeOk ? (
          <div style={{ filter: isSelected ? "grayscale(1) brightness(0.45)" : "none", transition: "filter 0.2s ease" }}>
            <PdfPreview url={previewUrl} filename={file.filename} />
          </div>
        ) : file.is_text && sizeOk ? (
          <div style={{ height: PREVIEW_HEIGHT, filter: isSelected ? "grayscale(1) brightness(0.45)" : "none", transition: "filter 0.2s ease" }}>
            <TextPreview url={previewUrl} extension={file.extension} />
          </div>
        ) : file.is_docx && sizeOk ? (
          <div style={{ height: PREVIEW_HEIGHT, filter: isSelected ? "grayscale(1) brightness(0.45)" : "none", transition: "filter 0.2s ease" }}>
            <DocxPreview url={previewUrl} />
          </div>
        ) : file.is_xlsx && sizeOk ? (
          <div style={{ height: PREVIEW_HEIGHT, filter: isSelected ? "grayscale(1) brightness(0.45)" : "none", transition: "filter 0.2s ease" }}>
            <XlsxPreview url={previewUrl} />
          </div>
        ) : (
          <div style={{
            width: "100%", height: PREVIEW_HEIGHT, borderRadius: "var(--radius)",
            background: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center",
            filter: isSelected ? "grayscale(1) brightness(0.45)" : "none", transition: "filter 0.2s ease",
          }}>
            <span className="mono" style={{
              fontSize: 22, fontWeight: 700, letterSpacing: 1, color: "var(--text-tertiary)",
              border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 18px",
            }}>
              {(file.extension || "file").replace(".", "").toUpperCase()}
            </span>
          </div>
        )}
        {/* Overlay label when marked for trash */}
        {isSelected && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <span style={{
              background: "rgba(220,50,50,0.85)", color: "#fff",
              fontSize: 11, fontWeight: 700, letterSpacing: 1,
              textTransform: "uppercase", borderRadius: 4, padding: "4px 10px",
            }}>
              🗑 Trash
            </span>
          </div>
        )}
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, wordBreak: "break-word" }}>{file.filename}</div>

      <div className="mono" style={{ fontSize: 13, color: "var(--text-secondary)", wordBreak: "break-all" }}>
        {file.path}
      </div>

      {/* Metadata row — size and date */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13, color: "var(--text-secondary)" }}>
        <span>{formatBytes(file.size_bytes)}</span>
        {formatModifiedDate(file.modified_unix) && (
          <span className="mono" style={{ color: "var(--text-tertiary)" }}>
            {formatModifiedDate(file.modified_unix)}
          </span>
        )}
      </div>

      {/* Buttons row — always below metadata */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => openFolder(file.path, t)} style={{
          background: "var(--bg-panel-raised)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 600, padding: "6px 12px",
        }}>
          {t("splitView.openFolder")}
        </button>
        <button onClick={() => openFile(file.path, t)} style={{
          background: "var(--bg-panel-raised)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", color: "var(--accent-teal)", fontSize: 13, fontWeight: 600, padding: "6px 12px",
        }}>
          {t("splitView.openFile")}
        </button>
        {role === "duplicate" && !isFreeMode && (
          <button onClick={onSetKeep} style={{
            background: "var(--bg-panel-raised)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", color: "var(--accent-teal)", fontSize: 13, fontWeight: 600, padding: "6px 12px",
          }}>
            {t("splitView.keepThisOneInstead")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function SplitView({ group, keepPath, onSetKeep, selectedForDeletion, onToggleSelect }: Props) {
  const { t } = useTranslation();

  const [dupIndex, setDupIndex] = useState(0);
  useEffect(() => {
    setDupIndex(0);
  }, [group?.hash]);

  if (!group) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)" }}>
        {t("splitView.selectPrompt")}
      </div>
    );
  }

  const keepFile = group.files.find((f) => f.path === keepPath) ?? group.files[0];
  const duplicates = group.files.filter((f) => f.path !== keepFile.path);
  const currentDup = duplicates[dupIndex] ?? duplicates[0];
  const hasMultiple = duplicates.length > 1;
  const markedCount = duplicates.filter((f) => selectedForDeletion.has(f.path)).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

      {/* ── Info bar — split into two halves mirroring the panels below.
          Left half: summary text (aligned with KEEP panel).
          Right half: navigator centered (aligned with DUPLICATE panel).
          Both halves sit on the same horizontal line. ── */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        flexShrink: 0,
      }}>
        {/* Left half — summary info */}
        <div style={{
          flex: 1,
          padding: "10px 20px",
          background: "var(--bg-panel-raised)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--text-tertiary)",
        }}>
          <span>
            {t("splitView.summaryLabel", { count: group.files.length, size: formatBytes(group.size_bytes) })}{" "}
            &middot;{" "}
            <span style={{ color: "var(--accent-teal)" }}>{formatBytes(group.wasted_bytes)}</span>{" "}
            {t("splitView.reclaimable")}
          </span>
          {markedCount > 0 && (
            <span style={{ color: "var(--accent-danger)", fontWeight: 600, marginLeft: 12 }}>
              {markedCount} / {duplicates.length} {t("splitView.markedLabel")}
            </span>
          )}
        </div>

        {/* Right half — navigator centered over the duplicate panel */}
        <div style={{
          flex: 1,
          padding: "6px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 38,
        }}>
          {hasMultiple && (
            <>
              <button
                onClick={() => setDupIndex((i) => Math.max(0, i - 1))}
                disabled={dupIndex === 0}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  color: dupIndex === 0 ? "var(--text-tertiary)" : "var(--text-primary)",
                  padding: "3px 10px",
                  fontSize: 16,
                  lineHeight: 1,
                  cursor: dupIndex === 0 ? "default" : "pointer",
                }}
              >
                ‹
              </button>
              <span className="mono" style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                minWidth: 42,
                textAlign: "center",
                margin: "0 10px",
              }}>
                {dupIndex + 1} / {duplicates.length}
              </span>
              <button
                onClick={() => setDupIndex((i) => Math.min(duplicates.length - 1, i + 1))}
                disabled={dupIndex === duplicates.length - 1}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  color: dupIndex === duplicates.length - 1 ? "var(--text-tertiary)" : "var(--text-primary)",
                  padding: "3px 10px",
                  fontSize: 16,
                  lineHeight: 1,
                  cursor: dupIndex === duplicates.length - 1 ? "default" : "pointer",
                }}
              >
                ›
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Panels ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: KEEP */}
        <div style={{ flex: 1, padding: 16, overflowY: "auto", borderRight: "1px solid var(--border)" }}>
          <FileCard
            file={keepFile} role="keep"
            onSetKeep={() => {}} isSelected={false} onToggleSelect={() => {}}
            previewDelay={0}
          />
        </div>

        {/* Right: current DUPLICATE */}
        <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
          <FileCard
            key={currentDup.path}
            file={currentDup}
            role="duplicate"
            onSetKeep={() => onSetKeep(currentDup.path)}
            isSelected={selectedForDeletion.has(currentDup.path)}
            onToggleSelect={() => onToggleSelect(currentDup.path)}
            previewDelay={200}
          />
        </div>
      </div>
    </div>
  );
}
