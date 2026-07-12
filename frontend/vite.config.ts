import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri-specific tweaks per https://tauri.app/v1/guides/getting-started/setup/vite
// - fixed dev server port so src-tauri/tauri.conf.json can point at it
// - don't let Vite obscure Rust/C++ build errors in the terminal
// - ignore src-tauri so file changes there don't trigger frontend HMR
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
