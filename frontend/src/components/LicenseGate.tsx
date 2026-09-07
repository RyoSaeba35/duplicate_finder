import { createContext, useContext, useEffect, useRef, useState } from "react";
import { activateLicense, getTrialStatus, TrialStatus } from "../api";
import { useTranslation } from "../i18n/context";

const BUY_URL = "https://getduplicatefinder.app/buy";
const FREE_MODE_SEEN_KEY = "dupfinder-freemode-seen";

interface AppModeValue { isFreeMode: boolean; }
export const AppModeContext = createContext<AppModeValue>({ isFreeMode: false });
export function useAppMode(): AppModeValue { return useContext(AppModeContext); }

// ── Activation success modal ──────────────────────────────────────────────────
// Shown once after a Gumroad license key validates successfully.
// Gives the user a clear "you're now Pro" moment before unlocking the UI.

function ActivationSuccessModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="activation-success-title"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 300, padding: 20,
      }}
    >
      <div style={{
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", width: "100%", maxWidth: 400,
        padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", gap: 16, textAlign: "center",
      }}>
        <div style={{ fontSize: 40 }}>✅</div>
        <div>
          <h2 id="activation-success-title" style={{ margin: "0 0 8px", fontSize: 18, color: "var(--text-primary)" }}>
            {t("activation.successTitle")}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {t("activation.successBody")}
          </p>
        </div>
        <button
          onClick={onClose}
          autoFocus
          style={{
            background: "var(--accent-teal)", border: "none",
            borderRadius: "var(--radius)", color: "var(--bg-base)",
            fontWeight: 700, fontSize: 14, padding: "11px 0",
          }}
        >
          {t("activation.successButton")} →
        </button>
      </div>
    </div>
  );
}

// ── Activation form ───────────────────────────────────────────────────────────

interface ActivationFormProps {
  onActivated: () => void;
  compact?: boolean;
}

function ActivationForm({ onActivated, compact }: ActivationFormProps) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await activateLicense(key.trim());
      if (result.success) {
        // Show the success modal before unlocking the UI.
        setShowSuccess(true);
      } else {
        setError(result.error ?? t("licenseGate.invalidKey"));
      }
    } catch {
      setError(t("licenseGate.couldNotReachServer"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit}
        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text" value={key} onChange={(e) => setKey(e.target.value)}
          placeholder={t("licenseGate.activationPlaceholder")}
          className="mono"
          style={{
            background: "var(--bg-panel-raised)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", color: "var(--text-primary)",
            padding: "8px 10px", fontSize: 13, width: compact ? 220 : 280,
          }}
        />
        <button type="submit" disabled={submitting || !key.trim()} style={{
          background: "var(--accent-teal)", border: "none",
          borderRadius: "var(--radius)", color: "var(--bg-base)",
          fontWeight: 600, padding: "8px 14px",
          opacity: submitting || !key.trim() ? 0.6 : 1,
        }}>
          {submitting ? t("licenseGate.checking") : t("licenseGate.activate")}
        </button>
        {error && <span style={{ color: "var(--accent-danger)", fontSize: 12 }}>{error}</span>}
      </form>

      {showSuccess && (
        <ActivationSuccessModal onClose={() => { setShowSuccess(false); onActivated(); }} />
      )}
    </>
  );
}

// ── Trial banner ──────────────────────────────────────────────────────────────

function TrialBanner({ status, onActivated }: { status: TrialStatus; onActivated: () => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      background: "var(--bg-panel)", borderBottom: "1px solid var(--border)",
      padding: "8px 16px", display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          {t("licenseGate.trialRemaining", { remaining: status.days_remaining, total: status.trial_days })}
        </span>
        <button onClick={() => setExpanded((v) => !v)} style={{
          background: "transparent", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", color: "var(--text-primary)",
          fontSize: 12, padding: "4px 10px",
        }}>
          {t("licenseGate.haveLicenseKey")}
        </button>
        <a href={BUY_URL} target="_blank" rel="noreferrer"
          style={{ color: "var(--accent-teal)", fontSize: 12, marginLeft: "auto" }}>
          {t("licenseGate.buyNow")}
        </a>
      </div>
      {expanded && <ActivationForm onActivated={onActivated} compact />}
    </div>
  );
}

// ── Free mode: one-time first-launch modal ────────────────────────────────────

function FreeModeFirstLaunchModal({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="freemode-modal-title"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
      }}>
      <div style={{
        background: "var(--bg-panel)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", width: 400, padding: 24,
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <h2 id="freemode-modal-title" style={{ margin: 0, fontSize: 15, color: "var(--text-primary)" }}>
          {t("licenseGate.freeModeModalTitle")}
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          {t("licenseGate.freeModeModalBody")}
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
          <button onClick={onDismiss} autoFocus style={{
            flex: 1, background: "var(--bg-panel-raised)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", color: "var(--text-primary)",
            fontWeight: 600, padding: "9px 0", fontSize: 13,
          }}>
            {t("licenseGate.freeModeGotIt")}
          </button>
          <a href={BUY_URL} target="_blank" rel="noreferrer" onClick={onDismiss}
            style={{
              flex: 1, background: "var(--accent-teal)", borderRadius: "var(--radius)",
              color: "var(--bg-base)", fontWeight: 700, padding: "9px 0", fontSize: 13,
              textDecoration: "none", textAlign: "center",
            }}>
            {t("licenseGate.freeModeModalUpgrade")}
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Free mode: persistent banner ──────────────────────────────────────────────

function FreeModeBanner({ onActivated }: { onActivated: () => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      background: "var(--bg-panel)", borderBottom: "1px solid var(--border)",
      padding: "8px 16px", display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          {t("licenseGate.freeModeBanner")}
        </span>
        <button onClick={() => setExpanded((v) => !v)} style={{
          background: "transparent", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", color: "var(--text-primary)",
          fontSize: 12, padding: "4px 10px",
        }}>
          {t("licenseGate.haveLicenseKey")}
        </button>
        <a href={BUY_URL} target="_blank" rel="noreferrer"
          style={{ color: "var(--accent-teal)", fontSize: 12, fontWeight: 600, marginLeft: "auto", textDecoration: "none" }}>
          {t("licenseGate.freeModeUpgrade")}
        </a>
      </div>
      {expanded && <ActivationForm onActivated={onActivated} compact />}
    </div>
  );
}

// ── Backend error screen ──────────────────────────────────────────────────────

function BackendErrorScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 12, padding: 24, textAlign: "center", color: "var(--text-primary)",
    }}>
      <h2 style={{ margin: 0 }}>{t("licenseGate.couldNotReachBackend")}</h2>
      <p style={{ margin: 0, color: "var(--text-secondary)", maxWidth: 380 }}>
        {t("licenseGate.scanningEngineDidNotRespond")}
      </p>
      <button onClick={onRetry} style={{
        background: "var(--accent-teal)", border: "none",
        borderRadius: "var(--radius)", color: "var(--bg-base)",
        fontWeight: 600, padding: "8px 14px",
      }}>
        {t("licenseGate.retry")}
      </button>
    </div>
  );
}

// ── Main gate ─────────────────────────────────────────────────────────────────

export default function LicenseGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [connectFailed, setConnectFailed] = useState(false);
  const [showFreeModeModal, setShowFreeModeModal] = useState(false);
  const attemptsRef = useRef(0);

  async function refresh() {
    try {
      const s = await getTrialStatus();
      setStatus(s);
      setConnectFailed(false);
      attemptsRef.current = 0;
      const isFreeMode = !s.licensed && s.expired;
      if (isFreeMode && !window.localStorage.getItem(FREE_MODE_SEEN_KEY)) {
        setShowFreeModeModal(true);
      }
    } catch {
      attemptsRef.current += 1;
      if (attemptsRef.current >= 20) { setConnectFailed(true); return; }
      setTimeout(refresh, 500);
    }
  }

  useEffect(() => { refresh(); }, []);

  function dismissFreeModeModal() {
    window.localStorage.setItem(FREE_MODE_SEEN_KEY, "1");
    setShowFreeModeModal(false);
  }

  if (connectFailed) {
    return <BackendErrorScreen onRetry={() => { attemptsRef.current = 0; setConnectFailed(false); refresh(); }} />;
  }
  if (!status) {
    return <div style={{ height: "100%", background: "var(--bg-panel)" }} />;
  }

  const isFreeMode = !status.licensed && status.expired;
  const isTrialActive = !status.licensed && !status.expired;

  return (
    <AppModeContext.Provider value={{ isFreeMode }}>
      {showFreeModeModal && <FreeModeFirstLaunchModal onDismiss={dismissFreeModeModal} />}
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {isFreeMode && <FreeModeBanner onActivated={refresh} />}
        {isTrialActive && <TrialBanner status={status} onActivated={refresh} />}
        <div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
      </div>
    </AppModeContext.Provider>
  );
}
