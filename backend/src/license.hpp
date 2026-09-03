// license.hpp
// Local, offline license key verification for Duplicate Finder.
//
// This is a lightweight checksum-style scheme, not a full PKI (Ed25519
// was considered and set aside -- Gumroad's own license key API will
// eventually generate/track keys server-side, per the project plan). For
// now, keys are generated offline with tools/generate_license.py (using
// the same salt as here) and verified locally with no network call.
// Anyone who extracts kLicenseSalt from the compiled binary could forge
// keys; that's an accepted tradeoff for a solo-dev indie tool, not a gap
// to close before shipping -- the goal is stopping casual key-sharing,
// not defeating a determined reverse engineer.
//
// Key format (case-insensitive, dashes/spaces ignored): 24 hex chars,
// e.g. "3F9A2B7C9E114D08A62F1B3C", typically displayed in groups of 4:
// "3F9A-2B7C-9E11-4D08-A62F-1B3C"
//   - first 16 hex chars: serial (arbitrary, unique per sale)
//   - last 8 hex chars:   checksum = sha256(kLicenseSalt + serial)[0:8]

#pragma once

#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>

#include "picosha2.h"
#include "trial.hpp"  // reuses app_data_dir()

namespace dupfinder {

namespace fs = std::filesystem;

// A different salt than the trial state uses -- these protect different
// things and should never share a secret.
constexpr const char* kLicenseSalt = "dupfinder-b7f2-license-salt-v1";
constexpr size_t kSerialLen = 16;
constexpr size_t kChecksumLen = 8;
constexpr size_t kKeyLen = kSerialLen + kChecksumLen;

inline fs::path license_state_path() {
    return app_data_dir() / ".dflicense";
}

// Strips dashes/spaces and uppercases. Returns "" if the result isn't
// exactly kKeyLen hex characters.
inline std::string normalize_key(const std::string& raw) {
    std::string out;
    out.reserve(raw.size());
    for (char c : raw) {
        if (c == '-' || c == ' ') continue;
        out.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(c))));
    }
    if (out.size() != kKeyLen) return "";
    for (char c : out) {
        if (!std::isxdigit(static_cast<unsigned char>(c))) return "";
    }
    return out;
}

inline std::string license_checksum_for(const std::string& serial /* 16 uppercase hex */) {
    std::string input = std::string(kLicenseSalt) + serial;
    std::string full = picosha2::hash256_hex_string(input);
    std::string upper;
    upper.reserve(kChecksumLen);
    for (size_t i = 0; i < kChecksumLen; i++) {
        upper.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(full[i]))));
    }
    return upper;
}

inline bool license_key_is_valid(const std::string& raw_key) {
    std::string key = normalize_key(raw_key);
    if (key.empty()) return false;
    std::string serial = key.substr(0, kSerialLen);
    std::string checksum = key.substr(kSerialLen, kChecksumLen);
    return license_checksum_for(serial) == checksum;
}

// Persists a validated key to disk so future runs don't need re-entry.
// Caller must have already confirmed license_key_is_valid(raw_key).
inline bool save_license_key(const std::string& raw_key) {
    std::error_code ec;
    fs::create_directories(app_data_dir(), ec);
    std::ofstream out(license_state_path(), std::ios::trunc);
    if (!out) return false;
    out << normalize_key(raw_key);
    return true;
}

// Loads a previously-saved key and re-verifies it -- never trust a file
// on disk without recomputing the checksum, or anyone could hand-write
// an unlock file directly without ever having a real key.
inline bool has_valid_saved_license() {
    std::error_code ec;
    if (!fs::exists(license_state_path(), ec)) return false;
    std::ifstream in(license_state_path());
    std::string stored;
    in >> stored;
    if (in.fail()) return false;
    return license_key_is_valid(stored);
}

}  // namespace dupfinder
