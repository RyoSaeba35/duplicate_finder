// api.ts — thin client for the Tauri backend.
// All scan logic runs natively in-process via Rust commands.

import { invoke } from "@tauri-apps/api/tauri";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface FileEntry {
  path: string;
  filename: string;
  size_bytes: number;
  extension: string;
  is_image: boolean;
  is_text: boolean;
  is_docx: boolean;
  is_xlsx: boolean;
  modified_unix: number;
}

export interface DuplicateGroup {
  hash: string;
  size_bytes: number;
  wasted_bytes: number;
  files: FileEntry[];
}

export type ScanStatus = "running" | "done" | "error" | "cancelled";

export interface ScanProgress {
  status: ScanStatus;
  files_seen: number;
  files_hashed: number;
  candidates: number;
  bytes_hashed: number;
  current_path: string;
  error_message: string;
}

export interface ScanOptions {
  skipHiddenSystem?: boolean;
  skipSystemFolders?: boolean;
  skipDevNoise?: boolean;
  /// Only hash files with these extensions e.g. [".jpg", ".pdf"].
  /// Empty array = no filter, all extensions are scanned.
  extensionFilter?: string[];
  excludedFolders?: string[];
}

export async function startScan(
  path: string,
  minSizeKb: number,
  options: ScanOptions,
  onProgress: (p: ScanProgress) => void,
  onResults: (groups: DuplicateGroup[]) => void
): Promise<UnlistenFn> {
  const request = {
    path,
    min_size_kb: minSizeKb,
    ...(options.skipHiddenSystem !== undefined && { skip_hidden_system: options.skipHiddenSystem }),
    ...(options.skipSystemFolders !== undefined && { skip_system_folders: options.skipSystemFolders }),
    ...(options.skipDevNoise !== undefined && { skip_dev_noise: options.skipDevNoise }),
    ...(options.extensionFilter && options.extensionFilter.length > 0 && {
      extension_filter: options.extensionFilter,
    }),
  };

  const unlistenEvent = await listen<any>("scan-event", (event) => {
    const msg = event.payload;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "progress") {
      onProgress(msg as ScanProgress);
    } else if (msg.type === "results") {
      onResults(msg.groups as DuplicateGroup[]);
    }
  });

  const unlistenTerminated = await listen("scan-terminated", () => {
    unlistenEvent();
    unlistenTerminated();
  });

  try {
    await invoke("start_scan", { request: JSON.stringify(request) });
  } catch (e) {
    unlistenEvent();
    unlistenTerminated();
    throw e instanceof Error ? e : new Error(String(e));
  }

  return () => {
    unlistenEvent();
    unlistenTerminated();
  };
}

export async function cancelScan(): Promise<void> {
  await invoke("cancel_scan");
}

export interface DeleteResult {
  path: string;
  deleted: boolean;
  error?: string;
}

export async function deleteFiles(paths: string[]): Promise<DeleteResult[]> {
  return invoke<DeleteResult[]>("delete_files", { paths });
}

export interface TrialStatus {
  licensed: boolean;
  expired: boolean;
  days_remaining: number;
  trial_days: number;
}

export async function getTrialStatus(): Promise<TrialStatus> {
  return invoke<TrialStatus>("trial_status");
}

export async function activateLicense(key: string): Promise<{ success: boolean; error?: string }> {
  return invoke<{ success: boolean; error?: string }>("activate_license", { key });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

export function formatModifiedDate(unixSeconds: number): string | null {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
