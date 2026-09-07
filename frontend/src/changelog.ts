// changelog.ts — static per-version changelog shown in the in-app modal.
//
// Rules:
//   • Always ordered newest → oldest.
//   • Add a new entry at the top for every release before building.
//   • Keep highlights short — one line per item, user-facing language.
//   • version must match tauri.conf.json "version" exactly.

export interface ChangelogEntry {
  version: string;
  highlights: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.3.5",
    highlights: [
      "Auto-update: the app now checks for new versions on launch and installs them with one click",
      "In-app changelog: see what's new after each update",
      "Custom folder exclusion list in scan options — skip specific folders by full path",
      "Buy link now routes through getduplicatefinder.app for stability across payment changes",
    ],
  },
  {
    version: "0.3.2",
    highlights: [
      "Photographer Mode: click any image or video thumbnail to open a full-screen preview",
      "Rotate images directly in the preview modal with ↺ / ↻ buttons",
      "Open file or containing folder directly from the preview modal",
    ],
  },
  {
    version: "0.3.1",
    highlights: [
      "Fixed buy link — now routes through a stable URL independent of payment platform",
    ],
  },
  {
    version: "0.3.0",
    highlights: [
      "Photographer Mode: dedicated scan tab for photo libraries",
      "RAW+JPEG pair detection — finds the same shot exported in both formats",
      "Lightroom catalog awareness — tracked files are flagged and protected from auto-select",
      "RAW thumbnail extraction for inline previews without external dependencies",
      "Bulk select, CSV export, and review modal before deletion",
    ],
  },
];

// Returns all changelog entries strictly newer than `sinceVersion`.
// Used to show only what changed since the user's last known version.
export function entriesSince(sinceVersion: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => isNewerVersion(e.version, sinceVersion));
}

// Simple semver comparison: returns true if `a` is strictly newer than `b`.
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}
