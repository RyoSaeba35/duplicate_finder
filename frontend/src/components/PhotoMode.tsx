// PhotoMode.tsx — Photographer Mode tab.
//
// Provides a scan flow tailored for photo libraries:
//   • Image/RAW-only scan (skips non-image files entirely)
//   • RAW+JPEG pair detection — same shot exported in two formats
//   • Exact duplicate detection via SHA-256 (same as General mode)
//   • Lightroom catalog awareness — flags tracked files with a badge
//     and excludes them from auto-select so the user can't accidentally
//     break their Lightroom library
//
// RAW files show an extension badge (WebView can't render raw formats);
// JPEG/PNG/etc show inline image previews.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PhotoDuplicateGroup, PhotoFileEntry, PhotoScanProgress, PhotoScanResults,
  RawJpegPair,
  cancelPhotoScan, formatBytes, formatModifiedDate,
  getRawThumbnail, startPhotoScan, validateLightroomCatalog,
} from "../photoApi";
import { useTranslation } from "../i18n/context";
import { useAppMode } from "./LicenseGate";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

const BUY_URL = "https://getduplicatefinder.app/buy";

type BulkRule = "newest" | "oldest" | "shortest";

function exportPhotoCsv(results: PhotoScanResults): void {
  const rows = ["Type,Group,Status,Filename,Path,Size (bytes),Modified,Lightroom"];
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  for (const group of results.exact_duplicates) {
    for (const [i, file] of group.files.entries()) {
      const status = i === 0 ? "KEEP" : "DUPLICATE";
      const modified = file.modified_unix
        ? new Date(file.modified_unix * 1000).toISOString() : "";
      rows.push([
        "DUPLICATE", group.hash.slice(0, 8), status,
        q(file.filename), q(file.path), file.size_bytes, modified,
        file.lightroom_tracked ? "Yes" : "No",
      ].join(","));
    }
  }
  for (const pair of results.raw_jpeg_pairs) {
    for (const [label, file] of [["RAW", pair.raw_file], ["JPEG", pair.jpeg_file]] as const) {
      const modified = (file as typeof pair.raw_file).modified_unix
        ? new Date((file as typeof pair.raw_file).modified_unix * 1000).toISOString() : "";
      rows.push([
        "RAWJPEG", q(pair.base_name), label,
        q((file as typeof pair.raw_file).filename), q((file as typeof pair.raw_file).path),
        (file as typeof pair.raw_file).size_bytes, modified,
        (file as typeof pair.raw_file).lightroom_tracked ? "Yes" : "No",
      ].join(","));
    }
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `photo-duplicates-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function LightroomBadge({ tooltip }: { tooltip: string }) {
  return (
    <span
      title={tooltip}
      style={{
        display: "inline-flex", alignItems: "center",
        background: "rgba(0,120,212,0.15)",
        border: "1px solid rgba(0,120,212,0.4)",
        borderRadius: 4, padding: "1px 6px",
        fontSize: 10, fontWeight: 700, color: "#4da6ff",
        letterSpacing: 0.3, flexShrink: 0,
      }}
    >
      LR
    </span>
  );
}

function ExtBadge({ ext }: { ext: string }) {
  return (
    <div style={{
      width: "100%", height: 160,
      background: "var(--bg-base)", borderRadius: "var(--radius)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span className="mono" style={{
        fontSize: 18, fontWeight: 700, letterSpacing: 1,
        color: "var(--text-tertiary)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", padding: "8px 14px",
      }}>
        {ext.replace(".", "").toUpperCase()}
      </span>
    </div>
  );
}

function ImagePreview({ file, dimmed }: { file: PhotoFileEntry; dimmed?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [rawB64, setRawB64] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setRawB64(null);

    if (file.is_raw || file.is_video) {
      if (file.is_raw) {
        setRawLoading(true);
        getRawThumbnail(file.path).then((b64) => {
          if (!cancelled) { setRawB64(b64); setRawLoading(false); }
        }).catch(() => {
          if (!cancelled) setRawLoading(false);
        });
      }
    } else {
      (async () => {
        try {
          const { convertFileSrc } = await import("@tauri-apps/api/tauri");
          if (!cancelled) setUrl(convertFileSrc(file.path));
        } catch {}
      })();
    }
    return () => { cancelled = true; };
  }, [file.path]);

  const imgStyle: React.CSSProperties = {
    width: "100%", height: 160, objectFit: "cover",
    borderRadius: "var(--radius)", background: "var(--bg-base)",
    display: "block",
    filter: dimmed ? "grayscale(1) brightness(0.45)" : "none",
    transition: "filter 0.2s ease",
  };

  if (file.is_video) {
    return <ExtBadge ext={file.extension} />;
  }

  if (file.is_raw) {
    if (rawLoading) {
      return (
        <div style={{
          width: "100%", height: 160, background: "var(--bg-base)",
          borderRadius: "var(--radius)", display: "flex",
          alignItems: "center", justifyContent: "center",
        }}>
          <span className="spinner" aria-hidden="true" />
        </div>
      );
    }
    if (rawB64) {
      return (
        <img
          src={`data:image/jpeg;base64,${rawB64}`}
          alt={file.filename}
          style={imgStyle}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      );
    }
    return <ExtBadge ext={file.extension} />;
  }

  if (!url) return <ExtBadge ext={file.extension} />;

  return (
    <img
      src={url}
      alt={file.filename}
      style={imgStyle}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

async function openInExplorer(path: string) {
  const sep = path.includes("\\") ? "\\" : "/";
  const folder = path.substring(0, path.lastIndexOf(sep)) || path;
  try {
    const { open } = await import("@tauri-apps/api/shell");
    await open(folder);
  } catch {}
}

async function openFile(path: string) {
  try {
    const { open } = await import("@tauri-apps/api/shell");
    await open(path);
  } catch {}
}

// ── Preview wrapper — hover overlay + click handler ───────────────────────────

function PreviewWrapper({
  onPreview, children,
}: {
  onPreview: () => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Preview file"
      style={{ position: "relative", cursor: "zoom-in" }}
      onClick={onPreview}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPreview(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <div style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,0.28)",
          display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: "var(--radius)",
          pointerEvents: "none",
        }}>
          <span style={{ fontSize: 20 }}>🔍</span>
        </div>
      )}
    </div>
  );
}

// ── Full-screen media preview modal ───────────────────────────────────────────

function MediaPreviewModal({
  file, onClose,
}: {
  file: PhotoFileEntry;
  onClose: () => void;
}) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [rawB64, setRawB64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [rotation, setRotation] = useState(0);

  // Close on Escape.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Load media URL — reset rotation on every new file.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMediaUrl(null);
    setRawB64(null);
    setVideoError(false);
    setRotation(0);

    if (file.is_raw) {
      getRawThumbnail(file.path).then((b64) => {
        if (!cancelled) { setRawB64(b64); setLoading(false); }
      }).catch(() => {
        if (!cancelled) setLoading(false);
      });
    } else {
      (async () => {
        try {
          const { convertFileSrc } = await import("@tauri-apps/api/tauri");
          if (!cancelled) { setMediaUrl(convertFileSrc(file.path)); setLoading(false); }
        } catch {
          if (!cancelled) setLoading(false);
        }
      })();
    }
    return () => { cancelled = true; };
  }, [file.path, file.is_raw]);

  const showFallback = !loading && (
    (file.is_raw && !rawB64) ||
    (!file.is_raw && !file.is_video && !mediaUrl) ||
    (file.is_video && (!mediaUrl || videoError))
  );

  // When rotated 90°/270° the image's layout width becomes the visual height and
  // vice-versa, so we swap max-width / max-height to avoid overflow.
  const isSideways = rotation === 90 || rotation === 270;
  const imgMaxW = isSideways ? "80vh" : "90vw";
  const imgMaxH = isSideways ? "90vw" : "80vh";

  const hasMedia = !loading && (mediaUrl !== null || rawB64 !== null);
  const isImage = !file.is_video;

  const toolBtnStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "var(--radius)",
    color: "rgba(255,255,255,0.75)",
    fontSize: 12, padding: "5px 10px",
    cursor: "pointer",
    display: "flex", alignItems: "center", gap: 5,
    whiteSpace: "nowrap",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200,
        // Reserve space for toolbar so the image centres in the remaining area.
        paddingTop: 56,
      }}
    >
      {/* ── Top toolbar ── */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute", top: 12, left: 16,
          display: "flex", gap: 8, alignItems: "center",
        }}
      >
        {/* Rotate buttons — images only, once loaded */}
        {isImage && hasMedia && (
          <>
            <button
              onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
              title="Rotate left"
              style={toolBtnStyle}
            >
              ↺ Rotate
            </button>
            <button
              onClick={() => setRotation((r) => (r + 90) % 360)}
              title="Rotate right"
              style={toolBtnStyle}
            >
              ↻ Rotate
            </button>
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.15)", flexShrink: 0 }} />
          </>
        )}
        <button onClick={() => openFile(file.path)} style={toolBtnStyle} title="Open file">
          ↗ Open file
        </button>
        <button onClick={() => openInExplorer(file.path)} style={toolBtnStyle} title="Open containing folder">
          📁 Open folder
        </button>
      </div>

      {/* ── ✕ close button ── */}
      <button
        onClick={onClose}
        aria-label="Close preview"
        style={{
          position: "absolute", top: 12, right: 16,
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: "50%", width: 34, height: 34,
          color: "rgba(255,255,255,0.7)", fontSize: 17,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", flexShrink: 0,
        }}
      >
        ✕
      </button>

      {/* ── Media area — stopPropagation prevents backdrop close ── */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        {loading && <span className="spinner" aria-hidden="true" />}

        {!loading && file.is_video && mediaUrl && !videoError && (
          <video
            src={mediaUrl}
            controls
            style={{
              maxWidth: "90vw", maxHeight: "80vh",
              borderRadius: "var(--radius)", background: "#000",
            }}
            onError={() => setVideoError(true)}
          />
        )}

        {!loading && file.is_raw && rawB64 && (
          <img
            src={`data:image/jpeg;base64,${rawB64}`}
            alt={file.filename}
            style={{
              maxWidth: imgMaxW, maxHeight: imgMaxH,
              objectFit: "contain", borderRadius: "var(--radius)",
              transform: `rotate(${rotation}deg)`,
              transition: "transform 0.25s ease",
            }}
          />
        )}

        {!loading && !file.is_video && !file.is_raw && mediaUrl && (
          <img
            src={mediaUrl}
            alt={file.filename}
            style={{
              maxWidth: imgMaxW, maxHeight: imgMaxH,
              objectFit: "contain", borderRadius: "var(--radius)",
              transform: `rotate(${rotation}deg)`,
              transition: "transform 0.25s ease",
            }}
          />
        )}

        {showFallback && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <span className="mono" style={{
              fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,0.3)",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: "var(--radius)",
              padding: "10px 20px",
            }}>
              {file.extension.replace(".", "").toUpperCase()}
            </span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
              Preview not available for this format
            </span>
          </div>
        )}
      </div>

      {/* ── Filename bar at bottom ── */}
      <div style={{
        position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        borderRadius: "var(--radius)", padding: "5px 16px",
        color: "rgba(255,255,255,0.6)", fontSize: 12,
        maxWidth: "80vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        pointerEvents: "none",
      }}>
        {file.filename}
      </div>
    </div>
  );
}

// ── RAW+JPEG pair card ────────────────────────────────────────────────────────

function RawJpegPairCard({
  pair, selectedForDeletion, onToggle, isFreeMode,
}: {
  pair: RawJpegPair;
  selectedForDeletion: Set<string>;
  onToggle: (path: string) => void;
  isFreeMode: boolean;
}) {
  const { t } = useTranslation();
  const { raw_file: raw, jpeg_file: jpeg } = pair;
  const [previewFile, setPreviewFile] = useState<PhotoFileEntry | null>(null);

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: "var(--radius)",
      background: "var(--bg-panel-raised)", padding: 14, marginBottom: 10,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* RAW side */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-teal)", textTransform: "uppercase" }}>
              {t("photoMode.rawLabel")}
            </span>
            {raw.lightroom_tracked && (
              <LightroomBadge tooltip={t("photoMode.lightroomTrackedTooltip")} />
            )}
          </div>
          <PreviewWrapper onPreview={() => setPreviewFile(raw)}>
            <ExtBadge ext={raw.extension} />
          </PreviewWrapper>
          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6, wordBreak: "break-word" }}>
            {raw.filename}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
            {formatBytes(raw.size_bytes)}
            {formatModifiedDate(raw.modified_unix) && ` · ${formatModifiedDate(raw.modified_unix)}`}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={() => openInExplorer(raw.path)} style={btnStyle}>
              {t("photoMode.openFolder")}
            </button>
            <button onClick={() => openFile(raw.path)} style={btnStyle}>
              {t("photoMode.openFile")}
            </button>
          </div>
          {!isFreeMode && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedForDeletion.has(raw.path)}
                disabled={raw.lightroom_tracked}
                onChange={() => onToggle(raw.path)}
              />
              <span style={{ color: raw.lightroom_tracked ? "var(--text-tertiary)" : "var(--text-secondary)" }}>
                {raw.lightroom_tracked ? t("photoMode.lightroomBadge") : t("photoMode.markForTrash")}
              </span>
            </label>
          )}
        </div>

        {/* JPEG side */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase" }}>
              {t("photoMode.jpegLabel")}
            </span>
            {jpeg.lightroom_tracked && (
              <LightroomBadge tooltip={t("photoMode.lightroomTrackedTooltip")} />
            )}
          </div>
          <PreviewWrapper onPreview={() => setPreviewFile(jpeg)}>
            <ImagePreview file={jpeg} dimmed={selectedForDeletion.has(jpeg.path)} />
          </PreviewWrapper>
          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6, wordBreak: "break-word" }}>
            {jpeg.filename}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
            {formatBytes(jpeg.size_bytes)}
            {formatModifiedDate(jpeg.modified_unix) && ` · ${formatModifiedDate(jpeg.modified_unix)}`}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={() => openInExplorer(jpeg.path)} style={btnStyle}>
              {t("photoMode.openFolder")}
            </button>
            <button onClick={() => openFile(jpeg.path)} style={btnStyle}>
              {t("photoMode.openFile")}
            </button>
          </div>
          {!isFreeMode && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedForDeletion.has(jpeg.path)}
                disabled={jpeg.lightroom_tracked}
                onChange={() => onToggle(jpeg.path)}
              />
              <span style={{ color: jpeg.lightroom_tracked ? "var(--text-tertiary)" : "var(--text-secondary)" }}>
                {jpeg.lightroom_tracked ? t("photoMode.lightroomBadge") : t("photoMode.markForTrash")}
              </span>
            </label>
          )}
        </div>
      </div>

      {previewFile && (
        <MediaPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </div>
  );
}

// ── Exact duplicate group card ────────────────────────────────────────────────

function DuplicateGroupCard({
  group, selectedForDeletion, onToggle, isFreeMode,
}: {
  group: PhotoDuplicateGroup;
  selectedForDeletion: Set<string>;
  onToggle: (path: string) => void;
  isFreeMode: boolean;
}) {
  const { t } = useTranslation();
  const keepFile = group.files[0];
  const duplicates = group.files.slice(1);
  const [previewFile, setPreviewFile] = useState<PhotoFileEntry | null>(null);

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: "var(--radius)",
      background: "var(--bg-panel-raised)", padding: 14, marginBottom: 10,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{keepFile.filename}</div>
        <span className="mono" style={{ fontSize: 12, color: "var(--accent-danger)" }}>
          {t("photoMode.wasted", { amount: formatBytes(group.wasted_bytes) })}
        </span>
      </div>

      {/* Files grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
        {group.files.map((file, idx) => {
          const isKeep = idx === 0;
          const isSelected = selectedForDeletion.has(file.path);
          return (
            <div key={file.path} style={{
              border: `1px solid ${isKeep ? "var(--accent-teal-dim)" : "var(--border)"}`,
              borderRadius: "var(--radius)", padding: 10,
              display: "flex", flexDirection: "column",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                  color: isKeep ? "var(--accent-teal)" : "var(--text-tertiary)",
                }}>
                  {isKeep ? t("splitView.keep") : t("splitView.duplicate")}
                </span>
                {file.lightroom_tracked && (
                  <LightroomBadge tooltip={t("photoMode.lightroomTrackedTooltip")} />
                )}
              </div>
              <PreviewWrapper onPreview={() => setPreviewFile(file)}>
                <div style={{ position: "relative" }}>
                  <ImagePreview file={file} dimmed={isSelected} />
                  {isSelected && (
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      pointerEvents: "none",
                    }}>
                      <span style={{
                        background: "rgba(220,50,50,0.85)", color: "#fff",
                        fontSize: 10, fontWeight: 700, letterSpacing: 1,
                        textTransform: "uppercase", borderRadius: 4, padding: "3px 8px",
                      }}>
                        🗑 Trash
                      </span>
                    </div>
                  )}
                </div>
              </PreviewWrapper>
              <div className="mono" style={{
                fontSize: 10, color: "var(--text-tertiary)", marginTop: 5,
                wordBreak: "break-all", lineHeight: 1.4,
              }}>
                {file.path}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3 }}>
                {formatBytes(file.size_bytes)}
              </div>
              {/* Open folder + mark for trash — pushed to bottom of card via flex */}
              <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                <button onClick={() => openInExplorer(file.path)} style={btnSmStyle}>
                  {t("photoMode.openFolder")}
                </button>
                {!isFreeMode ? (
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={file.lightroom_tracked}
                      onChange={() => onToggle(file.path)}
                    />
                    <span style={{ color: file.lightroom_tracked ? "var(--text-tertiary)" : "var(--text-secondary)" }}>
                      {file.lightroom_tracked ? "LR" : t("photoMode.markForTrash")}
                    </span>
                  </label>
                ) : (
                  <a href={BUY_URL} target="_blank" rel="noreferrer" style={{
                    display: "flex", alignItems: "center", gap: 4,
                    fontSize: 11, color: "var(--text-tertiary)", textDecoration: "none",
                  }}>
                    🔒 {t("licenseGate.freeModeMarkLocked")}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {previewFile && (
        <MediaPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </div>
  );
}

// ── Button style helpers ──────────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  background: "var(--bg-panel)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", color: "var(--text-secondary)",
  fontSize: 11, padding: "4px 8px",
};

const btnSmStyle: React.CSSProperties = {
  background: "var(--bg-panel)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", color: "var(--text-secondary)",
  fontSize: 10, padding: "3px 6px",
};

// Lazy-loading image preview for the review modal — uses objectFit: contain
// so the full image is always visible, constrained to a max height.
function ReviewImagePreview({ file }: { file: PhotoFileEntry }) {
  const [url, setUrl] = useState<string | null>(null);
  const [rawB64, setRawB64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setUrl(null);
    setRawB64(null);

    if (file.is_raw) {
      getRawThumbnail(file.path).then((b64) => {
        if (!cancelled) { setRawB64(b64); setLoading(false); }
      }).catch(() => {
        if (!cancelled) setLoading(false);
      });
    } else {
      (async () => {
        try {
          const { convertFileSrc } = await import("@tauri-apps/api/tauri");
          if (!cancelled) { setUrl(convertFileSrc(file.path)); setLoading(false); }
        } catch {
          if (!cancelled) setLoading(false);
        }
      })();
    }
    return () => { cancelled = true; };
  }, [file.path]);

  const containStyle: React.CSSProperties = {
    display: "block", maxWidth: "100%", maxHeight: 300,
    objectFit: "contain", borderRadius: "var(--radius)",
    background: "var(--bg-base)", margin: "0 auto",
  };

  if (loading) return (
    <div style={{ padding: "20px 0", display: "flex", justifyContent: "center" }}>
      <span className="spinner" aria-hidden="true" />
    </div>
  );

  if (file.is_raw && rawB64) {
    return (
      <img
        src={`data:image/jpeg;base64,${rawB64}`}
        alt={file.filename}
        style={containStyle}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    );
  }

  if (!file.is_raw && url) {
    return (
      <img
        src={url}
        alt={file.filename}
        style={containStyle}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    );
  }

  // Fallback: extension badge
  return (
    <div style={{
      background: "var(--bg-base)", borderRadius: "var(--radius)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 0",
    }}>
      <span className="mono" style={{
        fontSize: 16, fontWeight: 700, color: "var(--text-tertiary)",
        border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 14px",
      }}>
        {file.extension.replace(".", "").toUpperCase()}
      </span>
    </div>
  );
}

// ── Photo review modal ────────────────────────────────────────────────────────
// Shown before deletion — mirrors GeneralMode's ReviewModal in FinalList.tsx.

function PhotoReviewModal({
  selectedFiles, selectedBytes, onClose, onDelete, onDeselect,
}: {
  selectedFiles: PhotoFileEntry[];
  selectedBytes: number;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onDeselect: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      role="dialog" aria-modal="true" aria-labelledby="photo-review-title"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: 20,
      }}
    >
      <div style={{
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", width: "100%", maxWidth: 860,
        height: "90vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <h2 id="photo-review-title" style={{ margin: 0, fontSize: 15, color: "var(--text-primary)" }}>
              {t("finalList.reviewTitle", { count: selectedFiles.length })}
            </h2>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              {formatBytes(selectedBytes)} {t("finalList.reviewWillFree")}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", color: "var(--text-secondary)",
            padding: "6px 14px", fontSize: 13,
          }}>
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
                  onClick={() => setOpenPath(isOpen ? null : file.path)}
                  style={{
                    display: "flex", alignItems: "center", padding: "10px 20px",
                    cursor: "pointer", background: isOpen ? "var(--bg-panel-raised)" : "transparent",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", flexShrink: 0, width: 10 }}>
                    {isOpen ? "▾" : "▸"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {file.is_raw && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent-teal)",
                          marginRight: 6, textTransform: "uppercase" }}>RAW</span>
                      )}
                      {file.filename}
                    </div>
                    <div className="mono" style={{
                      fontSize: 11, color: "var(--text-tertiary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2,
                    }}>
                      {file.path}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {file.lightroom_tracked && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: "#4da6ff",
                        border: "1px solid rgba(0,120,212,0.4)", borderRadius: 4, padding: "1px 5px",
                      }}>LR</span>
                    )}
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
                        background: "transparent", border: "1px solid var(--border)",
                        borderRadius: "var(--radius)", color: "var(--text-tertiary)",
                        padding: "2px 8px", fontSize: 14, lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div style={{ padding: "0 20px 16px", background: "var(--bg-panel-raised)" }}>
                    <ReviewImagePreview file={file} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px", borderTop: "1px solid var(--border)",
          display: "flex", gap: 10, flexShrink: 0,
        }}>
          <button onClick={onClose} style={{
            flex: 1, background: "transparent", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", color: "var(--text-primary)", padding: "10px", fontSize: 13,
          }}>
            {t("confirmDeleteModal.cancel")}
          </button>
          <button onClick={() => setConfirmOpen(true)} style={{
            flex: 2, background: "var(--accent-danger)", border: "none",
            borderRadius: "var(--radius)", color: "#2a0d06",
            fontWeight: 700, padding: "10px", fontSize: 13,
          }}>
            {t("finalList.moveToTrash", { count: selectedFiles.length, size: formatBytes(selectedBytes) })}
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

// ── Main PhotoMode component ──────────────────────────────────────────────────

const LAST_PHOTO_PATH_KEY = "dupfinder-photo-last-path";
const LAST_LR_CATALOG_KEY = "dupfinder-photo-lr-catalog";

export default function PhotoMode() {
  const { t } = useTranslation();
  const { isFreeMode } = useAppMode();

  const [path, setPath] = useState(
    () => window.localStorage.getItem(LAST_PHOTO_PATH_KEY) ?? "C:\\"
  );
  const [lrCatalog, setLrCatalog] = useState(
    () => window.localStorage.getItem(LAST_LR_CATALOG_KEY) ?? ""
  );
  const [lrStatus, setLrStatus] = useState<{ count: number } | { error: string } | null>(null);

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<PhotoScanProgress | null>(null);
  const [results, setResults] = useState<PhotoScanResults | null>(null);
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(new Set());

  const [bulkRule, setBulkRule] = useState<BulkRule>("newest");
  const [reviewOpen, setReviewOpen] = useState(false);
  const unlistenRef = useRef<null | (() => void)>(null);

  function stopListening() {
    if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }
  }

  useEffect(() => () => stopListening(), []);

  // Validate Lightroom catalog when path changes (debounced).
  useEffect(() => {
    if (!lrCatalog.trim()) { setLrStatus(null); return; }
    const timer = setTimeout(async () => {
      try {
        const info = await validateLightroomCatalog(lrCatalog.trim());
        setLrStatus({ count: info.tracked_count });
      } catch {
        setLrStatus({ error: t("photoMode.lightroomError") });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [lrCatalog, t]);

  async function pickFolder() {
    try {
      const { open } = await import("@tauri-apps/api/dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") setPath(selected);
    } catch {}
  }

  async function pickCatalog() {
    try {
      const { open } = await import("@tauri-apps/api/dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Lightroom Catalog", extensions: ["lrcat"] }],
      });
      if (typeof selected === "string") {
        setLrCatalog(selected);
        window.localStorage.setItem(LAST_LR_CATALOG_KEY, selected);
      }
    } catch {}
  }

  function handleBulkSelect(rule: BulkRule) {
    if (isFreeMode || !results) return;
    const newSelected = new Set<string>();
    for (const group of results.exact_duplicates) {
      const files = [...group.files];
      let keepPath: string;
      if (rule === "newest") {
        files.sort((a, b) => {
          if (!a.modified_unix && !b.modified_unix) return 0;
          if (!a.modified_unix) return 1;
          if (!b.modified_unix) return -1;
          return b.modified_unix - a.modified_unix;
        });
        keepPath = files[0].path;
      } else if (rule === "oldest") {
        files.sort((a, b) => {
          if (!a.modified_unix && !b.modified_unix) return 0;
          if (!a.modified_unix) return 1;
          if (!b.modified_unix) return -1;
          return a.modified_unix - b.modified_unix;
        });
        keepPath = files[0].path;
      } else {
        files.sort((a, b) => a.path.length - b.path.length);
        keepPath = files[0].path;
      }
      for (const file of group.files) {
        if (file.path !== keepPath && !file.lightroom_tracked) {
          newSelected.add(file.path);
        }
      }
    }
    setSelectedForDeletion(newSelected);
  }

  async function handleScan() {
    window.localStorage.setItem(LAST_PHOTO_PATH_KEY, path);
    setResults(null);
    setSelectedForDeletion(new Set());
    setScanning(true);
    setProgress(null);
    stopListening();

    try {
      unlistenRef.current = await startPhotoScan(
        path,
        lrCatalog,
        (p) => {
          setProgress(p);
          if (p.status !== "running") setScanning(false);
        },
        (r) => setResults(r)
      );
    } catch (e) {
      setScanning(false);
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  function toggleSelect(filePath: string) {
    if (isFreeMode) return;
    setSelectedForDeletion((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath); else next.add(filePath);
      return next;
    });
  }

  const selectedFiles: PhotoFileEntry[] = results
    ? [
        ...results.exact_duplicates.flatMap((g) => g.files),
        ...results.raw_jpeg_pairs.flatMap((p) => [p.raw_file, p.jpeg_file]),
      ].filter((f) => selectedForDeletion.has(f.path))
    : [];

  const selectedBytes = selectedFiles.reduce((s, f) => s + f.size_bytes, 0);
  const reclaimableBytes = results
    ? results.exact_duplicates.reduce((s, g) => s + g.wasted_bytes, 0)
    : 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Scan controls ── */}
      <div style={{
        borderBottom: "1px solid var(--border)", background: "var(--bg-panel)",
        padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0,
      }}>
        {/* Row 1: photo folder */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={path} onChange={(e) => setPath(e.target.value)}
            placeholder={t("photoMode.sourceFolderPlaceholder")}
            disabled={scanning} className="mono"
            style={{
              flex: 1, background: "var(--bg-panel-raised)",
              border: "1px solid var(--border)", borderRadius: "var(--radius)",
              color: "var(--text-primary)", padding: "8px 10px",
            }}
          />
          <button onClick={pickFolder} disabled={scanning} style={{
            background: "var(--bg-panel-raised)", color: "var(--text-primary)",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            padding: "8px 14px", whiteSpace: "nowrap",
          }}>
            {t("scanControls.browse")}
          </button>
          {!scanning ? (
            <button onClick={handleScan} disabled={!path} style={{
              background: "var(--accent-teal)", color: "#08201e",
              border: "none", borderRadius: "var(--radius)",
              padding: "8px 16px", fontWeight: 600, whiteSpace: "nowrap",
            }}>
              {t("photoMode.scan")}
            </button>
          ) : (
            <button onClick={() => cancelPhotoScan()} style={{
              background: "transparent", color: "var(--accent-danger)",
              border: "1px solid var(--accent-danger-dim)",
              borderRadius: "var(--radius)", padding: "8px 16px", fontWeight: 600,
            }}>
              {t("photoMode.cancel")}
            </button>
          )}
        </div>

        {/* Row 2: Lightroom catalog */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {t("photoMode.lightroomCatalog")}
          </span>
          <input
            value={lrCatalog} onChange={(e) => setLrCatalog(e.target.value)}
            placeholder={t("photoMode.lightroomPlaceholder")}
            disabled={scanning} className="mono"
            style={{
              flex: 1, background: "var(--bg-panel-raised)",
              border: "1px solid var(--border)", borderRadius: "var(--radius)",
              color: "var(--text-primary)", padding: "6px 10px", fontSize: 12,
            }}
          />
          <button onClick={pickCatalog} disabled={scanning} style={{
            background: "var(--bg-panel-raised)", color: "var(--text-secondary)",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            padding: "6px 12px", fontSize: 12, whiteSpace: "nowrap",
          }}>
            {t("scanControls.browse")}
          </button>
          {lrStatus && (
            <span style={{
              fontSize: 11, whiteSpace: "nowrap", flexShrink: 0,
              color: "error" in lrStatus ? "var(--accent-danger)" : "var(--accent-teal)",
            }}>
              {"error" in lrStatus
                ? lrStatus.error
                : t("photoMode.lightroomLoaded", { count: lrStatus.count.toLocaleString() })}
            </span>
          )}
        </div>

        {/* Row 3: progress */}
        {progress && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="mono" style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              {progress.status === "running" && <span className="spinner" aria-hidden="true" style={{ marginRight: 8 }} />}
              {progress.status === "running"
                ? t("photoMode.scanning", { seen: progress.files_seen.toLocaleString(), hashed: progress.files_hashed.toLocaleString() })
                : progress.status === "done" && results
                ? t("photoMode.done", { exact: results.exact_duplicates.length, pairs: results.raw_jpeg_pairs.length })
                : progress.status === "cancelled"
                ? t("scanControls.cancelled")
                : t("scanControls.error", { message: progress.error_message })}
            </span>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {selectedForDeletion.size > 0 && (
                <span className="mono" style={{ fontSize: 13, color: "var(--accent-danger)", fontWeight: 600 }}>
                  {t("photoMode.markedCounter", { count: selectedForDeletion.size, size: formatBytes(selectedBytes) })}
                </span>
              )}
              <span className="mono" style={{
                fontSize: 13, fontWeight: 600,
                color: reclaimableBytes > 0 ? "var(--accent-teal)" : "var(--text-tertiary)",
              }}>
                {t("photoMode.reclaimable", { amount: formatBytes(reclaimableBytes) })}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Bulk select + CSV toolbar (shown when results available) ── */}
      {results && (results.exact_duplicates.length > 0 || results.raw_jpeg_pairs.length > 0) && (
        <div style={{
          borderBottom: "1px solid var(--border)", background: "var(--bg-panel-raised)",
          padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
        }}>
          {isFreeMode ? (
            <a href={BUY_URL} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: "var(--text-tertiary)", textDecoration: "none" }}>
              🔒 {t("groupList.bulkSelectLocked")}
            </a>
          ) : (
            <>
              <select
                value={bulkRule}
                onChange={(e) => setBulkRule(e.target.value as BulkRule)}
                style={{
                  background: "var(--bg-panel)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius)", color: "var(--text-secondary)",
                  padding: "4px 6px", fontSize: 11,
                }}
              >
                <option value="newest">{t("groupList.ruleNewest")}</option>
                <option value="oldest">{t("groupList.ruleOldest")}</option>
                <option value="shortest">{t("groupList.ruleShortest")}</option>
              </select>
              <button
                onClick={() => selectedForDeletion.size > 0
                  ? setSelectedForDeletion(new Set())
                  : handleBulkSelect(bulkRule)
                }
                style={{
                  background: selectedForDeletion.size > 0 ? "var(--bg-panel)" : "var(--accent-teal)",
                  border: selectedForDeletion.size > 0 ? "1px solid var(--border)" : "none",
                  borderRadius: "var(--radius)",
                  color: selectedForDeletion.size > 0 ? "var(--text-secondary)" : "var(--bg-base)",
                  fontSize: 11, fontWeight: 700, padding: "4px 10px", whiteSpace: "nowrap",
                }}
              >
                {selectedForDeletion.size > 0 ? t("groupList.deselectAll") : t("groupList.applyToAll")}
              </button>
            </>
          )}
          <button
            onClick={() => results && exportPhotoCsv(results)}
            style={{
              marginLeft: "auto", background: "transparent",
              border: "1px solid var(--border)", borderRadius: "var(--radius)",
              color: "var(--text-secondary)", fontSize: 11, padding: "4px 10px",
            }}
          >
            {t("groupList.exportCsv")}
          </button>
        </div>
      )}

      {/* ── Results ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {!results && !scanning && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
            {t("photoMode.noDuplicatesYet")}
          </div>
        )}

        {results && results.exact_duplicates.length === 0 && results.raw_jpeg_pairs.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
            {t("photoMode.noResults")}
          </div>
        )}

        {/* Exact duplicates section */}
        {results && results.exact_duplicates.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5,
              color: "var(--text-tertiary)", marginBottom: 12,
            }}>
              {t("photoMode.sectionExactDuplicates")} — {results.exact_duplicates.length}
            </div>
            {results.exact_duplicates.map((group) => (
              <DuplicateGroupCard
                key={group.hash}
                group={group}
                selectedForDeletion={selectedForDeletion}
                onToggle={toggleSelect}
                isFreeMode={isFreeMode}
              />
            ))}
          </div>
        )}

        {/* RAW+JPEG pairs section */}
        {results && results.raw_jpeg_pairs.length > 0 && (
          <div>
            <div style={{
              fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5,
              color: "var(--text-tertiary)", marginBottom: 12,
            }}>
              {t("photoMode.sectionRawJpeg")} — {results.raw_jpeg_pairs.length}
            </div>
            <div style={{
              fontSize: 12, color: "var(--text-tertiary)", marginBottom: 12,
              padding: "8px 12px", background: "var(--bg-panel-raised)",
              borderRadius: "var(--radius)", border: "1px solid var(--border)",
            }}>
              ⓘ {t("photoMode.lightroomHelp")}
            </div>
            {results.raw_jpeg_pairs.map((pair) => (
              <RawJpegPairCard
                key={pair.base_name}
                pair={pair}
                selectedForDeletion={selectedForDeletion}
                onToggle={toggleSelect}
                isFreeMode={isFreeMode}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Delete bar ── */}
      {selectedForDeletion.size > 0 && (
        <div style={{
          borderTop: "1px solid var(--border)", background: "var(--bg-panel)",
          padding: "10px 20px", flexShrink: 0,
        }}>
          {isFreeMode ? (
            <a href={BUY_URL} target="_blank" rel="noreferrer" style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 8, width: "100%", background: "var(--bg-panel-raised)",
              border: "1px solid var(--border)", borderRadius: "var(--radius)",
              color: "var(--accent-teal)", fontWeight: 700, fontSize: 13,
              padding: "10px", textDecoration: "none",
            }}>
              🔒 {t("licenseGate.freeModeUpgrade")}
            </a>
          ) : (
            <button
              onClick={() => setReviewOpen(true)}
              style={{
                width: "100%", background: "var(--accent-danger)", color: "#2a0d06",
                border: "none", borderRadius: "var(--radius)",
                padding: "10px", fontWeight: 700, fontSize: 13,
              }}
            >
              {t("photoMode.reviewButton", {
                count: selectedForDeletion.size,
                size: formatBytes(selectedBytes),
              })}
            </button>
          )}
        </div>
      )}

      {reviewOpen && (
        <PhotoReviewModal
          selectedFiles={selectedFiles}
          selectedBytes={selectedBytes}
          onClose={() => setReviewOpen(false)}
          onDeselect={(path) => {
            setSelectedForDeletion((prev) => {
              const next = new Set(prev);
              next.delete(path);
              return next;
            });
          }}
          onDelete={async () => {
            const { deleteFiles } = await import("../api");
            const res = await deleteFiles(Array.from(selectedForDeletion));
            const deleted = new Set(res.filter((r) => r.deleted).map((r) => r.path));
            setSelectedForDeletion((prev) => {
              const next = new Set(prev);
              deleted.forEach((p) => next.delete(p));
              return next;
            });
            setResults((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                exact_duplicates: prev.exact_duplicates
                  .map((g) => ({ ...g, files: g.files.filter((f) => !deleted.has(f.path)) }))
                  .filter((g) => g.files.length >= 2),
                raw_jpeg_pairs: prev.raw_jpeg_pairs.filter(
                  (p) => !deleted.has(p.raw_file.path) && !deleted.has(p.jpeg_file.path)
                ),
              };
            });
          }}
        />
      )}
    </div>
  );
}
