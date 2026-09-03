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
import { useTranslation } from "./i18n/context";
import { useAppMode } from "./components/LicenseGate";
import { addScanRecord, incrementLastDeleteCount } from "./scanHistory";

const LAST_PATH_KEY = "dupfinder-last-path";
const LAST_MIN_SIZE_KEY = "dupfinder-min-size-kb";

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

  const unlistenRef = useRef<null | (() => void)>(null);
  const lastProgressRef = useRef<ScanProgress | null>(null);
  const currentPathRef = useRef<string>(path);

  // Sorted hashes reported by GroupList — used for keyboard arrow navigation.
  const sortedHashesRef = useRef<string[]>([]);
  const handleSortedHashes = useCallback((hashes: string[]) => {
    sortedHashesRef.current = hashes;
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  // ↑ / ↓  — navigate the sidebar
  // Space   — toggle mark/unmark all duplicates in the selected group
  // Guards: skip if focus is in an input/textarea/select so typing still works.
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

      {toast && (
        <Toast count={toast.count} bytes={toast.bytes} onDone={() => setToast(null)} />
      )}

      {showWelcome && (
        <WelcomeModal onClose={() => setShowWelcome(false)} />
      )}
    </div>
  );
}
