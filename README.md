# Duplicate Finder

A duplicate-file scanner: C++ backend (fast, multithreaded-ready file
walking + SHA-256 hashing) exposed as a local REST API, with a React
frontend wrapped in Tauri for a native Windows/Mac desktop app.

```
dup-finder/
├── backend/          C++ scan engine + REST API (cpp-httplib, header-only)
│   ├── include/       httplib.h, picosha2.h (vendored, no package manager needed)
│   ├── src/
│   │   ├── scanner.hpp   duplicate-detection logic (size-group → hash)
│   │   ├── trash.hpp     cross-platform move-to-trash (never permanent delete)
│   │   └── main.cpp      HTTP server exposing /scan, /scan/progress, etc.
│   └── CMakeLists.txt
├── frontend/          React + TypeScript UI (Vite)
│   └── src/
│       ├── api.ts               typed client for the backend API
│       ├── App.tsx              state + polling loop
│       └── components/
│           ├── ScanControls.tsx      path input, start/cancel, live progress
│           ├── GroupList.tsx         sidebar of duplicate sets found
│           ├── SplitView.tsx         split screen: keep (left) vs duplicates (right)
│           ├── FinalList.tsx         consolidated trash list + trigger
│           └── ConfirmDeleteModal.tsx confirmation before any trash action
└── src-tauri/          Thin Rust shell: launches the C++ binary as a
                         sidecar process, renders the React UI in a
                         native webview
    └── icons/           app icons (.ico, .icns, .png) — placeholder teal
                          squares, swap for real branding before shipping
```

## Status: fully working, built and tested end-to-end on native Windows

Every step below was actually run, not just written — including hitting and
fixing several real Windows-specific issues along the way (see "Gotchas we
hit" below). `cargo tauri dev` produces a genuine native window; `cargo
tauri build` produces a real `.msi`/`.exe` installer.

## Why this architecture

- **C++ does the actual work** (disk walk, hashing) — this is genuinely the
  performance-critical part, and it's where you get real C++ practice:
  filesystem APIs, RAII, threading.
- **Tauri's own backend is Rust**, but Tauri happily runs *any* binary as a
  "sidecar" process alongside the webview. That's what `src-tauri/src/main.rs`
  does — it spawns the compiled C++ binary and forwards its logs, but writes
  zero scanning logic itself.
- **The frontend is plain React/Vite, not Next.js.** Next.js's App
  Router/SSR model targets a web server rendering pages per-request — there's
  no server at runtime in a desktop app, just a static bundle loaded into a
  webview. Vite + React is the setup Tauri's own docs recommend for exactly
  this reason.

## Build & run — Windows (tested, this is the real sequence)

**Toolchain, once:**
1. Rust via rustup.rs
2. Visual Studio Build Tools with the **"Desktop development with C++"**
   workload — visualstudio.microsoft.com/visual-cpp-build-tools
3. Node.js LTS from nodejs.org
4. CMake from cmake.org/download — during install, choose "Add CMake to the
   system PATH"
5. `cargo install tauri-cli --version "^1.0"` — compiles from source, takes
   30–75 minutes depending on your machine. One-time cost.

**Build the C++ backend** — must run from a **"Developer PowerShell for VS"**
(Start Menu → search for it), not a regular PowerShell, since that's the one
with `cl.exe` (MSVC) on PATH:
```powershell
cd backend
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```
Produces `backend\build\Release\dupfinder_backend.exe`.

**Install frontend deps** (regular PowerShell is fine):
```powershell
cd frontend
npm install
```
If you get `running scripts is disabled on this system`, run once:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**Rename the backend binary for Tauri's sidecar convention:**
```powershell
cd backend\build\Release
Copy-Item dupfinder_backend.exe dupfinder_backend-x86_64-pc-windows-msvc.exe
```
(confirm your triple with `rustc -vV` — look for the `host:` line; most
modern Windows machines are `x86_64-pc-windows-msvc`)

**Run in dev mode:**
```powershell
cd src-tauri
cargo tauri dev
```
Opens a real native window — not a browser tab.

**Build the distributable installer:**
```powershell
cargo tauri build
```
Produces `.msi` and `.exe` (NSIS) installers under
`src-tauri\target\release\bundle\`.

## Gotchas we hit building this on Windows (all fixed, documented for next time)

- **`ScanStatus::ERROR` broke MSVC but not g++.** `windows.h` (pulled in
  transitively by `httplib.h`'s socket code) `#define`s `ERROR` as a macro
  left over from old GDI APIs. Any enum value literally named `ERROR` gets
  silently mangled into `0` before the compiler even sees it, producing
  a wall of unrelated-looking syntax errors. Renamed to `ScanStatus::FAILED`
  in both `scanner.hpp` and `main.cpp`. Worth remembering: avoid `ERROR`,
  `DELETE`, `IN`, `OUT` as identifiers in any code that might compile on
  Windows.
- **`beforeDevCommand`/`beforeBuildCommand` paths in `tauri.conf.json` are
  relative to the project root, not `src-tauri/`.** Originally written as
  `npm run dev --prefix ../frontend`; correct value is `--prefix frontend`.
- **A `build/` folder copied over from a WSL build breaks CMake on
  Windows** — it caches the original (WSL) source path and refuses to
  reconfigure elsewhere. Delete `build/` and re-run `cmake -B build` fresh
  after any cross-environment copy.
- **`node_modules` doesn't survive a WSL to Windows copy** (symlink-style
  entries in `.bin/` don't translate). Delete and `npm install` fresh on
  whichever OS you're actually building on.
- **Windows Defender real-time scanning makes `npm install` very slow**
  the first time (thousands of small files). Optional fix, run as
  Administrator: `Add-MpPreference -ExclusionPath "C:\path\to\project"`.
- **The quick-path buttons in `ScanControls.tsx` use a literal
  `%USERNAME%` placeholder** that only expands inside `cmd.exe`/PowerShell
  — the app opens paths directly, not through a shell, so it won't
  auto-substitute. Either hardcode your real username, or (better, a good
  next step) wire up Tauri's native folder-picker dialog instead.

## What's confirmed working end-to-end

- Real Windows Recycle Bin deletion via `SHFileOperationW` — tested by
  scanning a real Downloads folder, marking a duplicate, confirming via the
  modal, and verifying the file appeared in the actual Recycle Bin
  (restorable, not gone).
- Linux XDG trash (`~/.local/share/Trash/`) — same flow, tested in WSL.
- Full scan → duplicate detection → split view → keep/swap → trash flow
  through the real bundled Tauri app, not just the dev-mode browser preview.

## Known gaps / good next steps for learning C++

- **Hashing is single-threaded.** `scanner.hpp`'s `run()` has a comment
  marking where to parallelize — splitting `candidates` across a
  `std::thread` pool (or `std::async`) is the natural next step and a good
  concurrency exercise.
- **JSON parsing in `main.cpp` is hand-rolled** (just enough to read flat
  request bodies) to avoid a dependency. Swap in `nlohmann/json` once you
  want richer request shapes.
- **No perceptual/fuzzy image hashing yet** — current matching is exact
  byte-for-byte (SHA-256), so resized or re-compressed "duplicate" photos
  won't be caught. That's a distinct algorithm (e.g. average/difference
  hash) worth adding as a v2 feature.
- **Folder picker**: replace the `%USERNAME%`-placeholder quick-path
  buttons and raw text input with Tauri's native folder-picker dialog
  (`@tauri-apps/api/dialog`, already allowlisted in `tauri.conf.json`).
- **Icons are placeholders** — simple generated teal squares. Swap
  `src-tauri/icons/*` for real branding before treating this as a shippable
  v1.
- **macOS build is untested** — the C++ and CMake are platform-agnostic and
  *should* work unmodified with clang, and `trash.hpp` has a macOS branch,
  but none of it has actually been run on a Mac yet.
