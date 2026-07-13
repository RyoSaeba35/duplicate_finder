// api.ts — thin client for the local C++ backend REST API.
// The backend always runs on 127.0.0.1 so there's no auth/HTTPS concern.

const BASE_URL = "http://127.0.0.1:8721";

export interface FileEntry {
  path: string;
  filename: string;
  size_bytes: number;
  extension: string;
  is_image: boolean;
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

export async function startScan(path: string, minSizeKb = 1): Promise<void> {
  const res = await fetch(`${BASE_URL}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, min_size_kb: minSizeKb }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown error" }));
    throw new Error(body.error ?? `scan failed (${res.status})`);
  }
}

export async function cancelScan(): Promise<void> {
  await fetch(`${BASE_URL}/scan/cancel`, { method: "POST" });
}

export async function getProgress(): Promise<ScanProgress> {
  const res = await fetch(`${BASE_URL}/scan/progress`);
  return res.json();
}

export async function getResults(): Promise<DuplicateGroup[]> {
  const res = await fetch(`${BASE_URL}/scan/results`);
  return res.json();
}

export interface DeleteResult {
  path: string;
  deleted: boolean;
  error?: string;
}

export async function deleteFiles(paths: string[]): Promise<DeleteResult[]> {
  const res = await fetch(`${BASE_URL}/files/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  return res.json();
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
  if (!unixSeconds) return null; // 0 means the backend couldn't read it
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
