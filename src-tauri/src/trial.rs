// trial.rs — native Rust port of the C++ trial.hpp logic. Runs in-process
// inside the main Tauri binary: no subprocess spawn, no sidecar, nothing
// external to launch. This is the whole point of this port -- it removes
// the one variable every theory this session kept landing back on: a
// separate, unsigned, unrecognized executable being launched at all.
//
// Same on-disk format as the C++ version (first-run unix timestamp + a
// salted SHA-256 checksum in a plain space-separated file under
// %APPDATA%\DupFinder\.dfstate), so an existing install's trial state
// keeps working unchanged across this migration.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub const TRIAL_DAYS: i64 = 14;

// Same salt as the C++ version -- must match exactly, or every existing
// installed trial state file would suddenly read as "tampered".
const TRIAL_SALT: &str = "dupfinder-a1e9-trial-salt-v1";

#[derive(Serialize)]
pub struct TrialStatus {
    pub licensed: bool,
    pub expired: bool,
    pub days_remaining: i64,
    pub trial_days: i64,
}

pub fn app_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join("DupFinder")
}

fn trial_state_path() -> PathBuf {
    app_data_dir().join(".dfstate")
}

fn checksum_for(first_run_unix: i64) -> String {
    let input = format!("{TRIAL_SALT}{first_run_unix}");
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

struct TrialState {
    first_run_unix: i64,
    tampered: bool,
}

// Loads the trial state, creating it on first run. Mirrors the C++
// version's tamper handling exactly: a file that exists but whose
// checksum doesn't match (edited, corrupted, or the clock rolled back) is
// treated as expired, not as a fresh trial.
fn load_or_create_trial_state() -> TrialState {
    let dir = app_data_dir();
    let _ = fs::create_dir_all(&dir);
    let path = trial_state_path();

    if let Ok(contents) = fs::read_to_string(&path) {
        let mut parts = contents.split_whitespace();
        if let (Some(time_str), Some(stored_checksum)) = (parts.next(), parts.next()) {
            if let Ok(stored_time) = time_str.parse::<i64>() {
                let now = now_unix();
                if stored_time > 0
                    && stored_time <= now
                    && checksum_for(stored_time).eq_ignore_ascii_case(stored_checksum)
                {
                    return TrialState {
                        first_run_unix: stored_time,
                        tampered: false,
                    };
                }
            }
        }
        return TrialState {
            first_run_unix: 0,
            tampered: true,
        };
    }

    // First run: write a fresh state file.
    let now = now_unix();
    let checksum = checksum_for(now);
    let _ = fs::write(&path, format!("{now} {checksum}"));
    TrialState {
        first_run_unix: now,
        tampered: false,
    }
}

fn trial_days_remaining(state: &TrialState) -> i64 {
    if state.tampered {
        return 0;
    }
    let now = now_unix();
    let elapsed_days = (now - state.first_run_unix) as f64 / 86400.0;
    let remaining = TRIAL_DAYS - elapsed_days.floor() as i64;
    remaining.max(0)
}

fn trial_is_expired(state: &TrialState) -> bool {
    state.tampered || trial_days_remaining(&state) <= 0
}

/// Builds the full trial-status payload. `licensed` is looked up
/// separately (via license.rs) since that's a distinct concern from the
/// trial clock itself -- mirrors how main.cpp combined the two globals.
pub fn get_trial_status(licensed: bool) -> TrialStatus {
    let state = load_or_create_trial_state();
    TrialStatus {
        licensed,
        expired: trial_is_expired(&state),
        days_remaining: trial_days_remaining(&state),
        trial_days: TRIAL_DAYS,
    }
}
