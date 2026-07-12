import { useEffect, useRef, useState } from "react";
import {
  DuplicateGroup,
  ScanProgress,
  startScan,
  cancelScan,
  getProgress,
  getResults,
  deleteFiles,
} from "./api";
import ScanControls from "./components/ScanControls";
import GroupList from "./components/GroupList";
import SplitView from "./components/SplitView";
import FinalList from "./components/FinalList";

export default function App() {
  const [path, setPath] = useState("C:\\");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [keepOverrides, setKeepOverrides] = useState<Record<string, string>>({});
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(new Set());
  const pollRef = useRef<number | null>(null);

  async function handleStart() {
    setGroups([]);
    setSelectedHash(null);
    setSelectedForDeletion(new Set());
    setScanning(true);
    try {
      await startScan(path);
    } catch (e) {
      setScanning(false);
      alert(e instanceof Error ? e.message : "Failed to start scan");
      return;
    }
    poll();
  }

  function poll() {
    pollRef.current = window.setInterval(async () => {
      const p = await getProgress();
      setProgress(p);

      // Pull results continuously so the "reclaimable" counter and group
      // list update live during the scan, not just at the end.
      const r = await getResults();
      setGroups(r);

      if (p.status !== "running") {
        if (pollRef.current) clearInterval(pollRef.current);
        setScanning(false);
      }
    }, 600);
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleCancel() {
    await cancelScan();
  }

  function toggleSelect(filePath: string) {
    setSelectedForDeletion((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  async function handleDeleteSelected() {
    const paths = Array.from(selectedForDeletion);
    const results = await deleteFiles(paths);
    const deletedPaths = new Set(results.filter((r) => r.deleted).map((r) => r.path));
    const failed = results.filter((r) => !r.deleted);

    // Remove deleted files from their groups; drop groups that no longer
    // have a duplicate (i.e. only 1 file left).
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

    if (failed.length > 0) {
      const detail = failed[0].error ? `: ${failed[0].error}` : "";
      alert(
        `${failed.length} file(s) could not be moved to trash (in use or permission denied)${detail}`
      );
    }
  }

  const selectedGroup = groups.find((g) => g.hash === selectedHash) ?? null;
  const reclaimableBytes = groups.reduce((sum, g) => sum + g.wasted_bytes, 0);
  const selectedBytes = groups
    .flatMap((g) => g.files)
    .filter((f) => selectedForDeletion.has(f.path))
    .reduce((sum, f) => sum + f.size_bytes, 0);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <ScanControls
        path={path}
        onPathChange={setPath}
        scanning={scanning}
        progress={progress}
        reclaimableBytes={reclaimableBytes}
        onStart={handleStart}
        onCancel={handleCancel}
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <GroupList groups={groups} selectedHash={selectedHash} onSelect={setSelectedHash} />
        <SplitView
          group={selectedGroup}
          keepPath={selectedGroup ? keepOverrides[selectedGroup.hash] ?? selectedGroup.files[0].path : null}
          onSetKeep={(p) =>
            selectedGroup && setKeepOverrides((prev) => ({ ...prev, [selectedGroup.hash]: p }))
          }
          selectedForDeletion={selectedForDeletion}
          onToggleSelect={toggleSelect}
        />
      </div>

      <FinalList
        selectedPaths={Array.from(selectedForDeletion)}
        selectedBytes={selectedBytes}
        onDelete={handleDeleteSelected}
        onDeselect={toggleSelect}
      />
    </div>
  );
}
