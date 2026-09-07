import { useCallback, useEffect, useRef, useState } from "react";
import {
  DuplicateGroup, ScanProgress, ScanOptions,
  startScan, cancelScan, deleteFiles,
} from "./api";
import ScanControls from "./components/ScanControls";
import GroupList, { BulkRule } from "./components/GroupList";
import SplitView from "./components/SplitView";
import FinalList from "./components/FinalList";
import Toast from "./components/Toast";
import WelcomeModal, { shouldShowWelcome } from "./components/WelcomeModal";
import PhotoMode from "./components/PhotoMode";
import LanguageSwitcher from "./components/LanguageSwitcher";
import SettingsPanel from "./components/SettingsPanel";
import ChangelogModal from "./components/ChangelogModal";
import { useTranslation } from "./i18n/context";
import { useAppMode } from "./components/LicenseGate";
import { addScanRecord, incrementLastDeleteCount } from "./scanHistory";
import { entriesSince, isNewerVersion, ChangelogEntry } from "./changelog";

const LAST_PATH_KEY = "dupfinder-last-path";
const LAST_MIN_SIZE_KEY = "dupfinder-min-size-kb";
const LAST_SEEN_VERSION_KEY = "dupfinder-last-seen-version";

export default function App() {
  const { t } = useTranslation();
  const { isFreeMode } = useAppMode();

  const [path, setPath] = useState(
    () => window.localStorage.getItem(LAST_PATH_KEY) ?? "C:\\"
  );
  const [minSizeKb, setMinSizeKb] = useState(
    () => parseInt(window.localStorage.getItem(LAST_MIN_SIZE_KEY) ?? "1", 10)
  );
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [keepOverrides, setKeepOverrides] = useState<Record<string, string>>({});
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(new Set());
  const [scanOptions, setScanOptions] = useState<ScanOptions>({
    skipHiddenSystem: true,
    skipSystemFolders: true,
    skipDevNoise: true,
    extensionFilter: [],
  });
  const [toast, setToast] = useState<{ count: number; bytes: number } | null>(null);
  const [showWelcome, setShowWelcome] = useState(() => shouldShowWelcome());
  const [activeTab, setActiveTab] = useState<"general" | "photo">("general");

  // ── Update + changelog state ───────────────────────────────────────────────
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [changelogEntries, setChangelogEntries] = useState<ChangelogEntry[]>([]);
  const [currentVersion, setCurrentVersion] = useState("");

  const unlistenRef = useRef<null | (() => void)>(null);
  const lastProgressRef = useRef<ScanProgress | null>(null);
  const currentPathRef = useRef<string>(path);

  const sortedHashesRef = useRef<string[]>([]);
  const handleSortedHashes = useCallback((hashes: string[]) => {
    sortedHashesRef.current = hashes;
  }, []);

  // ── Version check + background update check on mount ──────────────────────
  useEffect(() => {
    async function init() {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        setCurrentVersion(version);

        // Show changelog if this is the first launch after an update.
        const lastSeen = window.localStorage.getItem(LAST_SEEN_VERSION_KEY) ?? "0.0.0";
        if (isNewerVersion(version, lastSeen)) {
          const entries = entriesSince(lastSeen);
          if (entries.length > 0) {
            setChangelogEntries(entries);
            // Small delay so the app finishes rendering before the modal appears.
            setTimeout(() => setShowChangelog(true), 1200);
          }
        }
        // Always save current version so next launch knows what the user has seen.
        window.localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
      } catch {
        // getVersion can fail in dev (browser preview) — safe to ignore.
      }

      // Background update check — silent on failure (offline, server down).
      try {
        const { checkUpdate } = await import("@tauri-apps/api/updater");
        const { shouldUpdate, manifest } = await checkUpdate();
        if (shouldUpdate && manifest?.version) {
          setUpdateInfo({ version: manifest.version });
        }
      } catch {
        // Offline or update server unreachable — don't show anything.
      }
    }

    init();
  }, []);

  async function handleInstallUpdate() {
    setInstallingUpdate(true);
    try {
      const { installUpdate } = await import("@tauri-apps/api/updater");
      const { relaunch } = await import("@tauri-apps/api/process");
      await installUpdate();
      await relaunch();
    } catch {
      setInstallingUpdate(false);
      setShowUpdateModal(false);
    }
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const hashes = sortedHashesRef.current;
        if (hashes.length === 0) return;
        const idx = selectedHash ? hashes.indexOf(selectedHash) : -1;
        const next =
          e.key === "ArrowDown"
            ? Math.min(idx + 1, hashes.length - 1)
            : Math.max(idx - 1, 0);
        if (next !== idx || idx === -1) {
          setSelectedHash(hashes[next === -1 ? 0 : next]);
        }
        return;
      }

      if (e.key === " " && selectedHash) {
        e.preventDefault();
        if (isFreeMode) return;
        const group = groups.find((g) => g.hash === selectedHash);
        if (!group) return;
        const keepPath = keepOverrides[selectedHash] ?? group.files[0].path;
        const duplicates = group.files.filter((f) => f.path !== keepPath);
        const allMarked = duplicates.every((f) => selectedForDeletion.has(f.path));
        setSelectedForDeletion((prev) => {
          const next = new Set(prev);
          if (allMarked) {
            duplicates.forEach((f) => next.delete(f.path));
          } else {
            duplicates.forEach((f) => next.add(f.path));
          }
          return next;
        });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedHash, groups, isFreeMode, keepOverrides, selectedForDeletion]);

  function stopListening() {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }

  function handlePathChange(p: string) { setPath(p); }

  function handleMinSizeKbChange(v: number) {
    setMinSizeKb(v);
    window.localStorage.setItem(LAST_MIN_SIZE_KEY, String(v));
  }

  function handleDeselectAll() {
    setSelectedForDeletion(new Set());
    setKeepOverrides({});
  }

  async function handleStart() {
    window.localStorage.setItem(LAST_PATH_KEY, path);
    currentPathRef.current = path;
    setGroups([]);
    setSelectedHash(null);
    setSelectedForDeletion(new Set());
    setKeepOverrides({});
    setScanning(true);
    lastProgressRef.current = null;
    stopListening();

    try {
      unlistenRef.current = await startScan(
        path, minSizeKb, scanOptions,
        (p) => {
          setProgress(p);
          lastProgressRef.current = p;
          if (p.status !== "running") setScanning(false);
        },
        (r) => {
          setGroups(r);
          const lastP = lastProgressRef.current;
          if (lastP && lastP.status === "done") {
            addScanRecord({
              date: new Date().toISOString(),
              path: currentPathRef.current,
              filesScanned: lastP.files_seen,
              setsFound: r.length,
              filesDeleted: 0,
            });
          }
        }
      );
    } catch (e) {
      setScanning(false);
      stopListening();
      alert(e instanceof Error ? e.message : t("app.failedToStartScan"));
    }
  }

  useEffect(() => { return () => { stopListening(); }; }, []);

  async function handleCancel() { await cancelScan(); }

  function toggleSelect(filePath: string) {
    if (isFreeMode) return;
    setSelectedForDeletion((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  function handleBulkSelect(rule: BulkRule) {
    if (isFreeMode) return;
    const newSelected = new Set<string>();
    const newKeepOverrides: Record<string, string> = {};

    for (const group of groups) {
      const files = [...group.files];
      let keepFile: typeof files[0];
      switch (rule) {
        case "newest":
          files.sort((a, b) => {
            if (!a.modified_unix && !b.modified_unix) return 0;
            if (!a.modified_unix) return 1;
            if (!b.modified_unix) return -1;
            return b.modified_unix - a.modified_unix;
          });
          keepFile = files[0]; break;
        case "oldest":
          files.sort((a, b) => {
            if (!a.modified_unix && !b.modified_unix) return 0;
            if (!a.modified_unix) return 1;
            if (!b.modified_unix) return -1;
            return a.modified_unix - b.modified_unix;
          });
          keepFile = files[0]; break;
        case "shortest":
          files.sort((a, b) => a.path.length - b.path.length);
          keepFile = files[0]; break;
      }
      newKeepOverrides[group.hash] = keepFile!.path;
      for (const file of group.files) {
        if (file.path !== keepFile!.path) newSelected.add(file.path);
      }
    }
    setSelectedForDeletion(newSelected);
    setKeepOverrides(newKeepOverrides);
  }

  async function handleDeleteSelected() {
    if (isFreeMode) return;
    const paths = Array.from(selectedForDeletion);
    const sizeByPath = new Map(
      groups.flatMap((g) => g.files).map((f) => [f.path, f.size_bytes])
    );
    const results = await deleteFiles(paths);
    const deletedPaths = new Set(results.filter((r) => r.deleted).map((r) => r.path));
    const failed = results.filter((r) => !r.deleted);
    const deletedCount = deletedPaths.size;
    const freedBytes = Array.from(deletedPaths).reduce(
      (sum, p) => sum + (sizeByPath.get(p) ?? 0), 0
    );

    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, files: g.files.filter((f) => !deletedPaths.has(f.path)) }))
        .filter((g) => g.files.length >= 2)
    );
    setSelectedForDeletion((prev) => {
      const next = new Set(prev);
      deletedPaths.forEach((p) => next.delete(p));
      return next;
    });

    if (deletedCount > 0) {
      incrementLastDeleteCount(deletedCount);
      setToast({ count: deletedCount, bytes: freedBytes });
    }
    if (failed.length > 0) {
      const detail = failed[0].error ? `: ${failed[0].error}` : "";
      alert(t("finalList.deleteFailedAlert", { count: failed.length, detail }));
    }
  }

  const selectedGroup = groups.find((g) => g.hash === selectedHash) ?? null;
  const reclaimableBytes = groups.reduce((sum, g) => sum + g.wasted_bytes, 0);
  const selectedFiles = groups.flatMap((g) => g.files).filter((f) => selectedForDeletion.has(f.path));
  const selectedBytes = selectedFiles.reduce((sum, f) => sum + f.size_bytes, 0);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* ── Tab bar ── */}
      <div style={{
        display: "flex", borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)", flexShrink: 0,
      }}>
        {(["general", "photo"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: "transparent", border: "none",
              borderBottom: activeTab === tab ? "2px solid var(--accent-teal)" : "2px solid transparent",
              color: activeTab === tab ? "var(--text-primary)" : "var(--text-tertiary)",
              padding: "10px 20px", fontSize: 13, fontWeight: activeTab === tab ? 700 : 400,
              cursor: "pointer", flexShrink: 0,
            }}
          >
            {tab === "general" ? t("tabs.general") : t("tabs.photographer")}
          </button>
        ))}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "0 12px" }}>
          {/* Update available badge */}
          {updateInfo && !showUpdateModal && (
            <button
              onClick={() => setShowUpdateModal(true)}
              style={{
                background: "var(--accent-teal)", color: "#08201e",
                border: "none", borderRadius: "var(--radius)",
                padding: "4px 10px", fontSize: 11, fontWeight: 700,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
              }}
            >
              ⬆ v{updateInfo.version} available
            </button>
          )}
          <LanguageSwitcher />
          <SettingsPanel />
        </div>
      </div>

      {activeTab === "photo" ? (
        <PhotoMode />
      ) : (
        <>
          <ScanControls
            path={path} onPathChange={handlePathChange}
            scanning={scanning} progress={progress}
            reclaimableBytes={reclaimableBytes}
            selectedCount={selectedForDeletion.size} selectedBytes={selectedBytes}
            minSizeKb={minSizeKb} onMinSizeKbChange={handleMinSizeKbChange}
            onStart={handleStart} onCancel={handleCancel}
            scanOptions={scanOptions} onScanOptionsChange={setScanOptions}
          />

          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <GroupList
              groups={groups} selectedHash={selectedHash}
              onSelect={setSelectedHash} onBulkSelect={handleBulkSelect}
              hasSelection={selectedForDeletion.size > 0}
              onDeselectAll={handleDeselectAll}
              onSortedHashes={handleSortedHashes}
            />
            <SplitView
              group={selectedGroup}
              keepPath={
                selectedGroup
                  ? keepOverrides[selectedGroup.hash] ?? selectedGroup.files[0].path
                  : null
              }
              onSetKeep={(p) =>
                selectedGroup &&
                setKeepOverrides((prev) => ({ ...prev, [selectedGroup.hash]: p }))
              }
              selectedForDeletion={selectedForDeletion}
              onToggleSelect={toggleSelect}
            />
          </div>

          <FinalList
            selectedFiles={selectedFiles} selectedBytes={selectedBytes}
            onDelete={handleDeleteSelected} onDeselect={toggleSelect}
          />
        </>
      )}

      {/* ── Update confirmation modal ── */}
      {showUpdateModal && updateInfo && (
        <div
          onClick={() => !installingUpdate && setShowUpdateModal(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 300, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", width: "100%", maxWidth: 380,
              padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
              Update available
            </div>
            <div className="mono" style={{ fontSize: 13, color: "var(--accent-teal)", marginBottom: 16 }}>
              v{updateInfo.version}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.5 }}>
              The app will download and install the update, then restart automatically.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowUpdateModal(false)}
                disabled={installingUpdate}
                style={{
                  flex: 1, background: "transparent", border: "1px solid var(--border)",
                  borderRadius: "var(--radius)", color: "var(--text-secondary)",
                  padding: "9px", fontSize: 13, cursor: "pointer",
                }}
              >
                Later
              </button>
              <button
                onClick={handleInstallUpdate}
                disabled={installingUpdate}
                style={{
                  flex: 2, background: "var(--accent-teal)", border: "none",
                  borderRadius: "var(--radius)", color: "#08201e",
                  padding: "9px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {installingUpdate ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Installing…
                  </>
                ) : (
                  "Install & Restart"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast count={toast.count} bytes={toast.bytes} onDone={() => setToast(null)} />
      )}

      {showWelcome && (
        <WelcomeModal onClose={() => setShowWelcome(false)} />
      )}

      {/* ── Changelog modal — shown once after an update ── */}
      {showChangelog && changelogEntries.length > 0 && (
        <ChangelogModal
          entries={changelogEntries}
          currentVersion={currentVersion}
          onClose={() => setShowChangelog(false)}
        />
      )}
    </div>
  );
}
