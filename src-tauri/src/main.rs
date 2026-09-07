// main.rs — the Tauri shell.
//
// App states:
//   TrialActive  (licensed=false, expired=false) → full access
//   FreeMode     (licensed=false, expired=true)  → scan + view free, deletion locked
//   Licensed     (licensed=true)                 → full Pro access
//
// Scanning is allowed in all three states — the trial-expired gate that
// used to block scans here has been removed. FreeMode users can scan
// freely; only deletion is locked, and that gate lives on the React side
// (SplitView lock icon + FinalList locked button + App.tsx guard).
//
// As of this version, NOTHING here spawns an external process at all.
// trial_status, activate_license, delete_files, and start_scan/cancel_scan
// all run natively in-process. The C++ backend (backend/, CMakeLists.txt,
// scanner.hpp, etc.) is no longer part of the shipped app at all -- it
// stays in the repo purely as the original portfolio/learning artifact.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod license;
mod lightroom;
mod photo_scanner;
mod raw_preview;
mod scanner;
mod trial;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

// Shared cancel flag for whichever scan is currently running. Reset to
// false at the start of every new scan. Only one scan runs at a time (the
// UI enforces that with its `scanning` state) -- if that assumption is
// ever relaxed, this single shared flag would need to become per-scan.
#[derive(Clone)]
struct ScanState(Arc<AtomicBool>);

#[tauri::command]
fn start_scan(
    app: tauri::AppHandle,
    scan_state: tauri::State<'_, ScanState>,
    request: String,
) -> Result<(), String> {
    let req: scanner::ScanRequest = serde_json::from_str(&request).map_err(|e| e.to_string())?;

    // No trial/license gate here anymore. Scanning is free in all states
    // (TrialActive, FreeMode, Licensed). Deletion is the gated feature,
    // and that check lives in delete_files below + the React UI layer.

    // Reset the shared cancel flag for this new scan.
    scan_state.0.store(false, Ordering::Relaxed);
    let cancel = scan_state.0.clone();
    let app_handle = app.clone();

    // Run on a dedicated OS thread, not the async runtime -- walking and
    // hashing is real CPU/IO work and would otherwise block every other
    // command while a scan is in progress.
    std::thread::spawn(move || {
        scanner::run_scan(
            req.path,
            req.min_size_kb * 1024,
            req.options,
            cancel,
            |event| {
                let _ = app_handle.emit_all("scan-event", &event);
            },
        );
        let _ = app_handle.emit_all("scan-terminated", ());
    });

    Ok(())
}

#[tauri::command]
fn cancel_scan(scan_state: tauri::State<'_, ScanState>) -> Result<(), String> {
    scan_state.0.store(true, Ordering::Relaxed);
    Ok(())
}

// Native, in-process trial status -- no subprocess spawn.
#[tauri::command]
fn trial_status() -> Result<trial::TrialStatus, String> {
    let licensed = license::has_valid_saved_license();
    Ok(trial::get_trial_status(licensed))
}

// License activation now involves ONE network call to Gumroad (see
// license.rs for why). Kept as a plain, non-async command: Tauri runs
// sync commands on its own thread pool, so this brief blocking call
// doesn't freeze the UI.
#[derive(serde::Serialize)]
struct ActivateResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
fn activate_license(key: String) -> Result<ActivateResult, String> {
    match license::activate(&key) {
        license::ActivateOutcome::Activated => Ok(ActivateResult {
            success: true,
            error: None,
        }),
        license::ActivateOutcome::Rejected(msg) => Ok(ActivateResult {
            success: false,
            error: Some(msg),
        }),
    }
}

#[derive(serde::Serialize)]
struct DeleteResult {
    path: String,
    deleted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// Native, in-process delete via the `trash` crate.
// Deletion is only reachable from the UI when licensed or in trial --
// the React layer (App.tsx isFreeMode guard + FinalList + SplitView lock)
// prevents FreeMode users from ever calling this. The check here is a
// belt-and-suspenders safety net.
#[tauri::command]
fn delete_files(paths: Vec<String>) -> Result<Vec<DeleteResult>, String> {
    let licensed = license::has_valid_saved_license();
    let status = trial::get_trial_status(licensed);

    // Block deletion in FreeMode at the Rust level as a safety net.
    if !licensed && status.expired {
        return Ok(paths
            .into_iter()
            .map(|path| DeleteResult {
                path,
                deleted: false,
                error: Some("deletion requires a license — upgrade at gumroad.com/l/byzsj".to_string()),
            })
            .collect());
    }

    let results = paths
        .into_iter()
        .map(|path| match trash::delete(&path) {
            Ok(()) => DeleteResult {
                path,
                deleted: true,
                error: None,
            },
            Err(e) => DeleteResult {
                path,
                deleted: false,
                error: Some(e.to_string()),
            },
        })
        .collect();
    Ok(results)
}


#[tauri::command]
fn start_photo_scan(
    app: tauri::AppHandle,
    scan_state: tauri::State<'_, ScanState>,
    path: String,
    lightroom_catalog: Option<String>,
) -> Result<(), String> {
    // Reset the shared cancel flag — photo scans share the same flag as
    // general scans since only one scan runs at a time.
    scan_state.0.store(false, Ordering::Relaxed);
    let cancel = scan_state.0.clone();
    let app_handle = app.clone();

    std::thread::spawn(move || {
        photo_scanner::run_photo_scan(
            path,
            lightroom_catalog,
            cancel,
            |event| {
                let _ = app_handle.emit_all("photo-scan-event", &event);
            },
        );
        let _ = app_handle.emit_all("photo-scan-terminated", ());
    });

    Ok(())
}

/// Validates a Lightroom catalog path and returns the number of tracked files,
/// or an error string. Called by the frontend when the user picks a .lrcat file
/// to give immediate feedback ("Catalog loaded — 12,345 files tracked").
#[derive(serde::Serialize)]
struct LightroomCatalogInfo {
    tracked_count: usize,
}

#[tauri::command]
fn validate_lightroom_catalog(path: String) -> Result<LightroomCatalogInfo, String> {
    let paths = lightroom::read_tracked_paths(&path)?;
    Ok(LightroomCatalogInfo { tracked_count: paths.len() })
}


/// Extracts the largest embedded JPEG preview from a RAW camera file and
/// returns it as a base64 string the frontend can use as a data: URI.
/// Returns null if no preview found (frontend falls back to extension badge).
#[tauri::command]
fn get_raw_thumbnail(path: String) -> Option<String> {
    use base64::{Engine as _, engine::general_purpose};
    let bytes = raw_preview::extract_jpeg_preview(&path)?;
    Some(general_purpose::STANDARD.encode(&bytes))
}

fn main() {
    tauri::Builder::default()
        .manage(ScanState(Arc::new(AtomicBool::new(false))))
        .invoke_handler(tauri::generate_handler![
            start_scan,
            cancel_scan,
            trial_status,
            activate_license,
            delete_files,
            start_photo_scan,
            validate_lightroom_catalog,
            get_raw_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
