import { useTranslation } from "../i18n/context";

const CREDITS: { name: string; license: string; url: string }[] = [
  { name: "picosha2", license: "MIT", url: "https://github.com/okdshin/PicoSHA2" },
  { name: "React", license: "MIT", url: "https://react.dev" },
  { name: "Tauri", license: "MIT / Apache-2.0", url: "https://tauri.app" },
  { name: "docx-preview", license: "MIT", url: "https://github.com/VolodymyrBaydalka/docxpreview" },
  { name: "SheetJS (via @e965/xlsx)", license: "Apache-2.0", url: "https://sheetjs.com" },
];

const APP_VERSION = "0.2.0";

// What changed in this version — English only, one-time content.
const CHANGELOG = [
  "Free mode — scan forever, upgrade once to delete",
  "Bulk auto-select by rule (keep newest / oldest / shortest path)",
  "Review panel with inline file previews before deleting",
  "Multi-copy navigator for sets with many duplicates",
  "Search, filter and sort in the sidebar",
  "Settings panel: font size, theme, scan history",
  "Export CSV report of all duplicate sets",
  "Scan history log",
  "KEEP file tooltip explaining the selection rule",
  "Live marked-files counter in the header",
];

interface Props {
  onClose: () => void;
}

export default function AboutPanel({ onClose }: Props) {
  const { t } = useTranslation();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", width: 440, maxHeight: "85vh",
          overflowY: "auto", padding: 24,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span aria-hidden="true" style={{
            width: 22, height: 22, borderRadius: 6, flexShrink: 0,
            background: "linear-gradient(135deg, var(--accent-teal), #2dd4a7)",
          }} />
          <h2 id="about-title" style={{ margin: 0, fontSize: 16 }}>
            {t("about.title")}
          </h2>
        </div>

        <div className="mono" style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 12 }}>
          {t("about.version", { version: APP_VERSION })}
        </div>

        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 20px" }}>
          {t("about.description")}
        </p>

        {/* What's new */}
        <div style={{
          fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5,
          color: "var(--text-tertiary)", marginBottom: 8,
        }}>
          {t("about.whatsNew")}
        </div>
        <ul style={{
          margin: "0 0 20px", padding: "0 0 0 16px",
          display: "flex", flexDirection: "column", gap: 5,
        }}>
          {CHANGELOG.map((item) => (
            <li key={item} style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {item}
            </li>
          ))}
        </ul>

        {/* Open source */}
        <div style={{
          fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5,
          color: "var(--text-tertiary)", marginBottom: 10,
        }}>
          {t("about.openSourceTitle")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {CREDITS.map((c) => (
            <div key={c.name} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--border)",
            }}>
              <a href={c.url} target="_blank" rel="noreferrer"
                style={{ color: "var(--text-primary)" }}>
                {c.name}
              </a>
              <span className="mono" style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
                {c.license}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%", background: "var(--bg-panel-raised)",
            border: "1px solid var(--border)", color: "var(--text-primary)",
            borderRadius: "var(--radius)", padding: "9px 0", fontWeight: 600,
          }}
        >
          {t("about.close")}
        </button>
      </div>
    </div>
  );
}
