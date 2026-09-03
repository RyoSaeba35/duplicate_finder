// scanHistory.ts — lightweight localStorage-backed scan log.
// Records one entry per completed scan (date, folder, files seen, sets found)
// and tracks how many files were deleted from that scan session.
// Capped at 20 entries so it never grows unbounded.

export interface ScanRecord {
  id: string;
  date: string;        // ISO string
  path: string;        // scanned folder
  filesScanned: number;
  setsFound: number;
  filesDeleted: number;
}

const STORAGE_KEY = "dupfinder-scan-history";
const MAX_ENTRIES = 20;

export function loadHistory(): ScanRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ScanRecord[];
  } catch {
    return [];
  }
}

export function addScanRecord(
  record: Omit<ScanRecord, "id">
): void {
  const history = loadHistory();
  const entry: ScanRecord = { id: Date.now().toString(), ...record };
  const updated = [entry, ...history].slice(0, MAX_ENTRIES);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

// Increments the filesDeleted count on the most recent history entry.
// Called after a successful batch delete so the history reflects what
// actually happened in that session.
export function incrementLastDeleteCount(count: number): void {
  const history = loadHistory();
  if (history.length === 0 || count === 0) return;
  history[0].filesDeleted += count;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function clearHistory(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
