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
│   │   └── main.cpp      HTTP server exposing /scan, /scan/progress, etc.
│   └── CMakeLists.txt
├── frontend/          React + TypeScript UI (Vite)
│   └── src/
│       ├── api.ts               typed client for the backend API
│       ├── App.tsx              state + polling loop
│       └── components/
│           ├── ScanControls.tsx  path input, start/cancel, live progress
│           ├── GroupList.tsx     sidebar of duplicate sets found
│           ├── SplitView.tsx     split screen: keep (left) vs duplicates (right)
│           └── FinalList.tsx     consolidated delete list + delete action
└── src-tauri/          Thin Rust shell: launches the C++ binary as a
                         sidecar process, renders the React UI in a
                         native webview
```

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
  this reason. All your Next.js component/hooks knowledge carries over
  directly; only the routing/data-fetching conventions differ (and this app
  doesn't need routing at all).

## Build & run (development)

**1. Build the C++ backend**
```bash
cd backend
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```
This was tested and compiles clean with g++ 13 / C++17 on Linux; MSVC on
Windows and clang on macOS should both work unmodified since only
`<filesystem>` and standard library are used (no platform-specific code).

**2. Install frontend deps**
```bash
cd frontend
npm install
```

**3. Install Tauri CLI (once)**
```bash
npm install -g @tauri-apps/cli
# or: cargo install tauri-cli
```

**4. Wire up the sidecar binary name**
Tauri requires sidecar binaries to be suffixed with the Rust target triple,
e.g. `dupfinder_backend-x86_64-pc-windows-msvc.exe` on Windows or
`dupfinder_backend-x86_64-apple-darwin` on Mac. After building the backend,
rename/copy the binary to match — a small script for this is worth adding
once you're building release binaries:
```bash
# example for macOS arm64
cp backend/build/dupfinder_backend backend/build/dupfinder_backend-aarch64-apple-darwin
```
Then update `externalBin` in `src-tauri/tauri.conf.json` to point at the
renamed file (drop the target-triple suffix in the config — Tauri appends it
automatically at build time).

**5. Run in dev mode**
```bash
cd src-tauri
cargo tauri dev
```

**6. Build a distributable app**
```bash
cargo tauri build
```
Produces a `.dmg`/`.app` on Mac and `.msi`/`.exe` (NSIS) on Windows.

## What's already working

The backend was tested end-to-end during development: it correctly walks a
directory, groups by size, hashes matches, and returns duplicate groups over
HTTP — verified against a test folder with a known duplicate file.

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
- **Folder picker**: the frontend currently takes a typed path; wiring up
  Tauri's native folder-picker dialog (`@tauri-apps/api/dialog`) instead of
  the raw text input is a quick, high-value addition.
