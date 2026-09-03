// trial.hpp
// Local trial-period tracking for Duplicate Finder. Stores a lightly
// obfuscated first-run timestamp under the OS app-data directory.
//
// This is NOT meant to defeat a determined attacker -- the goal is to make
// casual trial resets (e.g. editing a plaintext date in the state file)
// ineffective, at low engineering cost. A checksum ties the stored date to
// a compiled-in salt; if the file is edited without knowing the salt, the
// checksum won't match and the trial is treated as expired rather than
// reset -- so tampering makes things worse for the user, not better.
//
// This state is superseded entirely once a valid license key is present
// (see license.hpp, added in the next step) -- the trial check only
// applies to unlicensed installs.

#pragma once

#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <string>

#include "picosha2.h"

namespace dupfinder {

namespace fs = std::filesystem;

constexpr int kTrialDays = 14;

// Compiled into the binary. Not a secret in the cryptographic sense (it
// ships inside the .exe and can be extracted with enough effort), but it
// means resetting the trial requires pulling this string out of the binary
// or patching the check itself -- meaningfully more friction than editing
// a plaintext date, which is the actual goal here.
constexpr const char* kTrialSalt = "dupfinder-a1e9-trial-salt-v1";

struct TrialState {
    std::time_t first_run_unix = 0;
    bool tampered = false;  // file existed but checksum didn't match
};

inline fs::path app_data_dir() {
#if defined(_WIN32)
    const char* base = std::getenv("APPDATA");
    fs::path root = base ? fs::path(base) : fs::path(".");
#elif defined(__APPLE__)
    const char* home = std::getenv("HOME");
    fs::path root = (home ? fs::path(home) : fs::path("."))
                    / "Library" / "Application Support";
#else
    const char* xdg = std::getenv("XDG_DATA_HOME");
    fs::path root;
    if (xdg) {
        root = fs::path(xdg);
    } else {
        const char* home = std::getenv("HOME");
        root = (home ? fs::path(home) : fs::path(".")) / ".local" / "share";
    }
#endif
    return root / "DupFinder";
}

// Deliberately unremarkable filename -- no ".json"/".txt", nothing that
// screams "trial state" in a directory listing.
inline fs::path trial_state_path() {
    return app_data_dir() / ".dfstate";
}

inline std::string checksum_for(std::time_t first_run_unix) {
    std::string input = std::string(kTrialSalt) + std::to_string(first_run_unix);
    return picosha2::hash256_hex_string(input);
}

// Loads the trial state, creating it on first run. If the file exists but
// its checksum doesn't match (edited, corrupted, or the clock was rolled
// back to predate it), returns tampered=true -- the caller should treat
// that as expired, not as a fresh trial.
inline TrialState load_or_create_trial_state() {
    fs::path dir = app_data_dir();
    fs::path path = trial_state_path();
    std::error_code ec;
    fs::create_directories(dir, ec);

    if (fs::exists(path, ec)) {
        std::ifstream in(path);
        std::time_t stored_time = 0;
        std::string stored_checksum;
        in >> stored_time >> stored_checksum;
        std::time_t now = std::time(nullptr);
        if (!in.fail() && stored_time > 0 && stored_time <= now &&
            checksum_for(stored_time) == stored_checksum) {
            return TrialState{stored_time, false};
        }
        return TrialState{0, true};
    }

    // First run: write a fresh state file.
    std::time_t now = std::time(nullptr);
    std::ofstream out(path, std::ios::trunc);
    out << now << " " << checksum_for(now);
    return TrialState{now, false};
}

// Days remaining in the trial (0 if expired or tampered).
inline int trial_days_remaining(const TrialState& state) {
    if (state.tampered) return 0;
    std::time_t now = std::time(nullptr);
    double elapsed_days = std::difftime(now, state.first_run_unix) / 86400.0;
    int remaining = kTrialDays - static_cast<int>(elapsed_days);
    return remaining > 0 ? remaining : 0;
}

inline bool trial_is_expired(const TrialState& state) {
    return state.tampered || trial_days_remaining(state) <= 0;
}

}  // namespace dupfinder
