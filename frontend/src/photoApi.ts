// photoApi.ts — TypeScript client for the Photographer Mode scan backend.
// Mirrors the types defined in photo_scanner.rs and exposes them as a
// clean API that PhotoMode.tsx consumes.

import { invoke } from "@tauri-apps/api/tauri";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { formatBytes } from "./api";

export { formatBytes };

// ── Result types (mirror photo_scanner.rs) ────────────────────────────────────

export interface PhotoFileEntry {
  path: string;
  filename: string;
  size_bytes: number;
  extension: string;
  /** true if the extension is a known RAW camera format */
  is_raw: boolean;
  /** true if the extension is a video format */
  is_video: boolean;
  /** true if this path appears in the user's Lightroom catalog */
  lightroom_tracked: boolean;
  modified_unix: number;
}

export interface PhotoDuplicateGroup {
  hash: string;
  size_bytes: number;
  wasted_bytes: number;
  /** Sorted oldest-first by modification date; [0] is the suggested keep. */
  files: PhotoFileEntry[];
}

/** Same shot exported in two formats: one RAW + one JPEG. */
export interface RawJpegPair {
  base_name: string;
  raw_file: PhotoFileEntry;
  jpeg_file: PhotoFileEntry;
}

export interface PhotoScanResults {
  exact_duplicates: PhotoDuplicateGroup[];
  raw_jpeg_pairs: RawJpegPair[];
  lightroom_tracked_count: number;
}

export type PhotoScanStatus = "running" | "done" | "error" | "cancelled";

export interface PhotoScanProgress {
  status: PhotoScanStatus;
  files_seen: number;
  files_hashed: number;
  candidates: number;
  current_path: string;
  error_message: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function startPhotoScan(
  path: string,
  lightroomCatalog: string,
  onProgress: (p: PhotoScanProgress) => void,
  onResults: (results: PhotoScanResults) => void
): Promise<UnlistenFn> {
  const unlistenEvent = await listen<any>("photo-scan-event", (event) => {
    const msg = event.payload;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "progress") {
      onProgress(msg as PhotoScanProgress);
    } else if (msg.type === "results") {
      const { exact_duplicates, raw_jpeg_pairs, lightroom_tracked_count } = msg;
      onResults({ exact_duplicates, raw_jpeg_pairs, lightroom_tracked_count });
    }
  });

  const unlistenTerminated = await listen("photo-scan-terminated", () => {
    unlistenEvent();
    unlistenTerminated();
  });

  try {
    await invoke("start_photo_scan", {
      path,
      lightroomCatalog: lightroomCatalog.trim() || null,
    });
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

export async function cancelPhotoScan(): Promise<void> {
  // Shares the same cancel flag as the general scanner.
  await invoke("cancel_scan");
}

export interface LightroomCatalogInfo {
  tracked_count: number;
}

/** Validates a .lrcat path and returns how many files it tracks. */
export async function validateLightroomCatalog(
  path: string
): Promise<LightroomCatalogInfo> {
  return invoke<LightroomCatalogInfo>("validate_lightroom_catalog", { path });
}

export function formatModifiedDate(unixSeconds: number): string | null {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

/** Extracts the embedded JPEG preview from a RAW file, returned as base64.
 *  Returns null if the file has no extractable preview — the frontend then
 *  shows the extension badge as a fallback. */
export async function getRawThumbnail(path: string): Promise<string | null> {
  return invoke<string | null>("get_raw_thumbnail", { path });
}
