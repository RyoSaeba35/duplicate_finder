// SettingsPanel.tsx — gear button with dropdown for font size, theme,
// scan history, and about.

import { useEffect, useState } from "react";
import { applyTheme, getInitialTheme, Theme } from "../theme";
import AboutPanel from "./AboutPanel";
import { useTranslation } from "../i18n/context";
import { loadHistory, clearHistory, ScanRecord } from "../scanHistory";
import { formatBytes } from "../api";

type FontSize = "S" | "M" | "L";

const FONT_STORAGE_KEY = "dupfinder-fontsize";
const ZOOM_MAP: Record<FontSize, number> = { S: 0.88, M: 1, L: 1.15 };

function applyFontSize(size: FontSize): void {
  document.documentElement.style.setProperty("--ui-zoom", String(ZOOM_MAP[size]));
  window.localStorage.setItem(FONT_STORAGE_KEY, size);
}

function getInitialFontSize(): FontSize {
  const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
  if (stored === "S" || stored === "M" || stored === "L") return stored;
  return "M";
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

// ── Scan history modal ────────────────────────────────────────────────────────

function ScanHistoryModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<ScanRecord[]>([]);

  useEffect(() => {
    setRecords(loadHistory());
  }, []);

  function handleClear() {
    clearHistory();
    setRecords([]);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-modal-title"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          width: 480,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <h2 id="history-modal-title" style={{ margin: 0, fontSize: 15 }}>
            {t("scanHistory.title")}
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            {records.length > 0 && (
              <button
                onClick={handleClear}
                style={{
                  background: "transparent", border: "1px solid var(--border)",
                  borderRadius: "var(--radius)", color: "var(--text-tertiary)",
                  fontSize: 12, padding: "5px 10px",
                }}
              >
                {t("scanHistory.clear")}
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: "transparent", border: "1px solid var(--border)",
                borderRadius: "var(--radius)", color: "var(--text-secondary)",
                fontSize: 12, padding: "5px 10px",
              }}
            >
              {t("scanHistory.close")}
            </button>
          </div>
        </div>

        {/* List */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {records.length === 0 ? (
            <div style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 13 }}>
              {t("scanHistory.empty")}
            </div>
          ) : (
            records.map((r) => (
              <div key={r.id} style={{
                padding: "12px 20px",
                borderBottom: "1px solid var(--border)",
              }}>
                {/* Date */}
                <div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>
                  {new Date(r.date).toLocaleString()}
                </div>
                {/* Path */}
                <div className="mono" style={{
                  fontSize: 12, color: "var(--text-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  marginBottom: 4,
                }}>
                  {r.path}
                </div>
                {/* Stats */}
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" }}>
                  <span>{r.filesScanned.toLocaleString()} files scanned</span>
                  <span style={{ color: "var(--accent-teal)" }}>{r.setsFound} duplicate sets</span>
                  {r.filesDeleted > 0 && (
                    <span style={{ color: "var(--accent-danger)" }}>{r.filesDeleted} deleted</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main settings panel ───────────────────────────────────────────────────────

export default function SettingsPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fontSize, setFontSize] = useState<FontSize>("M");
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const initialFont = getInitialFontSize();
    setFontSize(initialFont);
    applyFontSize(initialFont);

    const initialTheme = getInitialTheme();
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  function handleFontSize(s: FontSize) {
    setFontSize(s);
    applyFontSize(s);
  }

  function handleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 49 }}
        />
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        title={t("settings.title")}
        aria-label={t("settings.title")}
        aria-expanded={open}
        style={{
          background: open ? "var(--bg-panel-raised)" : "transparent",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          color: "var(--text-secondary)",
          padding: "8px 10px",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <GearIcon />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          background: "var(--bg-panel)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          padding: "14px", width: 210, zIndex: 50,
          display: "flex", flexDirection: "column", gap: 14,
        }}>
          {/* Text size */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-tertiary)" }}>
              {t("settings.textSize")}
            </span>
            <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              {(["S", "M", "L"] as FontSize[]).map((s) => (
                <button
                  key={s}
                  onClick={() => handleFontSize(s)}
                  aria-pressed={fontSize === s}
                  style={{
                    flex: 1,
                    background: fontSize === s ? "var(--accent-teal)" : "transparent",
                    border: "none",
                    borderRight: s !== "L" ? "1px solid var(--border)" : "none",
                    color: fontSize === s ? "var(--bg-base)" : "var(--text-secondary)",
                    padding: "7px 0",
                    fontSize: s === "S" ? 11 : s === "M" ? 13 : 15,
                    fontWeight: fontSize === s ? 700 : 400,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-tertiary)" }}>
              {t("settings.theme")}
            </span>
            <button
              onClick={handleTheme}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "var(--bg-panel-raised)", border: "1px solid var(--border)",
                borderRadius: "var(--radius)", color: "var(--text-primary)",
                padding: "7px 10px", fontSize: 13, textAlign: "left",
              }}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              {theme === "dark" ? t("themeToggle.switchToLight") : t("themeToggle.switchToDark")}
            </button>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "var(--border)", margin: "0 -2px" }} />

          {/* Scan history */}
          <button
            onClick={() => { setHistoryOpen(true); setOpen(false); }}
            style={{
              background: "transparent", border: "none",
              color: "var(--text-secondary)", fontSize: 13,
              textAlign: "left", padding: "0",
            }}
          >
            {t("settings.scanHistory")} →
          </button>

          {/* About */}
          <button
            onClick={() => { setAboutOpen(true); setOpen(false); }}
            style={{
              background: "transparent", border: "none",
              color: "var(--text-secondary)", fontSize: 13,
              textAlign: "left", padding: "0",
            }}
          >
            {t("about.openButton")} →
          </button>
        </div>
      )}

      {historyOpen && <ScanHistoryModal onClose={() => setHistoryOpen(false)} />}
      {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
