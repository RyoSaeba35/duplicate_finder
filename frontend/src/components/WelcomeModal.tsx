import { useTranslation } from "../i18n/context";

const WELCOME_SEEN_KEY = "dupfinder-welcome-seen";

export function shouldShowWelcome(): boolean {
  return !window.localStorage.getItem(WELCOME_SEEN_KEY);
}

export function markWelcomeSeen(): void {
  window.localStorage.setItem(WELCOME_SEEN_KEY, "1");
}

const STEPS = [
  {
    emoji: "🔍",
    title: "Scan any folder",
    body: "Pick a folder — or your whole C:\\ drive. We walk every subfolder and find identical files by content, not just name.",
  },
  {
    emoji: "👁",
    title: "Compare side by side",
    body: "The left panel shows the file to keep (oldest copy). The right panel shows duplicates. Click any set in the sidebar to inspect it.",
  },
  {
    emoji: "⚡",
    title: "Bulk select in one click",
    body: "Use Bulk Select in the sidebar to apply a rule across all sets at once — keep newest, keep oldest, or keep the shortest path. Marks everything automatically.",
  },
  {
    emoji: "👀",
    title: "Review before deleting",
    body: "Click the Review button to open a full list of every file about to be deleted. Click any row to preview it inline — then confirm when ready. Files go to your Recycle Bin, nothing is permanent.",
  },
  {
    emoji: "⌨️",
    title: "Keyboard shortcuts",
    body: "↑ ↓ to navigate the sidebar. Space to mark / unmark all duplicates in the selected set.",
  },
];

interface Props {
  onClose: () => void;
}

export default function WelcomeModal({ onClose }: Props) {
  const { t } = useTranslation();

  function handleClose() {
    markWelcomeSeen();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, padding: 20,
      }}
    >
      <div style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        width: "100%", maxWidth: 480,
        maxHeight: "90vh",
        overflowY: "auto",
        padding: 28,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", gap: 20,
      }}>
        {/* Header */}
        <div>
          <h2 id="welcome-title" style={{ margin: "0 0 4px", fontSize: 18, color: "var(--text-primary)" }}>
            {t("welcome.title")}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-tertiary)" }}>
            Galerne Studio — v0.2.0
          </p>
        </div>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {STEPS.map((step) => (
            <div key={step.title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1.3 }}>{step.emoji}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>
                  {step.title}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {step.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Button */}
        <button
          onClick={handleClose}
          autoFocus
          style={{
            width: "100%",
            background: "var(--accent-teal)",
            border: "none",
            borderRadius: "var(--radius)",
            color: "var(--bg-base)",
            fontWeight: 700,
            fontSize: 14,
            padding: "11px 0",
          }}
        >
          {t("welcome.getStarted")} →
        </button>
      </div>
    </div>
  );
}
