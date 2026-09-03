// theme.ts — dark/light theme persistence for the desktop app. Uses
// localStorage directly (this is a real Tauri/WebView2 app, not a
// claude.ai artifact — localStorage is fully supported and the standard
// place for a UI preference like this to live).

export type Theme = "dark" | "light";

const STORAGE_KEY = "dupfinder-theme";

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  // No explicit choice yet — respect the OS-level preference as the
  // starting point, but this is just a default; the user's own toggle
  // always wins from here on and gets remembered.
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem(STORAGE_KEY, theme);
}
