#pragma once
// scanner.hpp
// Core duplicate-detection engine: walks a directory tree, groups files by
// size (cheap first pass), then hashes same-size files with SHA-256 to
// confirm true duplicates. Designed to run scans on a background thread and
// report progress so the frontend can show a live progress bar.

#include <atomic>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "picosha2.h"

namespace dupfinder {

namespace fs = std::filesystem;

struct FileEntry {
    std::string path;
    std::string filename;
    uint64_t size_bytes = 0;
    std::string extension;
    int64_t modified_unix = 0; // seconds since epoch, 0 if unavailable
};

struct DuplicateGroup {
    std::string hash;
    uint64_t size_bytes = 0;
    std::vector<FileEntry> files; // files[0] is treated as the "original"
};

// NOTE: deliberately not called "ERROR" — windows.h (pulled in transitively
// via httplib.h's socket code on Windows) #defines ERROR as a macro (a
// leftover from old GDI APIs), which silently mangles any enum value named
// ERROR into garbage on MSVC. FAILED avoids the collision entirely.
enum class ScanStatus { RUNNING, DONE, FAILED, CANCELLED };

struct ScanProgress {
    ScanStatus status = ScanStatus::RUNNING;
    uint64_t files_seen = 0;
    uint64_t files_hashed = 0;
    uint64_t candidates = 0; // files that share a size with >=1 other file
    uint64_t bytes_hashed = 0;
    std::string current_path;
    std::string error_message;
};

// Extensions we treat as "images" for the UI's filtering, purely cosmetic —
// duplicate detection itself is content-based and works for any file type.
inline bool is_image_ext(const std::string& ext) {
    static const std::vector<std::string> image_exts = {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp",
        ".heic", ".tiff", ".tif", ".raw", ".svg"
    };
    for (const auto& e : image_exts) if (e == ext) return true;
    return false;
}

// Converts a filesystem last-write-time to Unix epoch seconds. Before
// C++20, std::filesystem::file_time_type isn't directly comparable to
// std::chrono::system_clock — there's no standard conversion. This is the
// commonly-used portable workaround: measure the offset between the two
// clocks "now" and apply it, which works correctly on both libstdc++ and
// MSVC's STL. Returns 0 (rather than throwing) if the timestamp can't be
// read, e.g. an in-use system file — the frontend just omits the date in
// that case.
inline int64_t file_time_to_unix(const fs::path& p) {
    std::error_code ec;
    auto ftime = fs::last_write_time(p, ec);
    if (ec) return 0;

    auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
        ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
    return static_cast<int64_t>(std::chrono::system_clock::to_time_t(sctp));
}

class Scanner {
public:
    // Kicks off a scan of `root` on a background thread. Safe to poll
    // progress()/results() from another thread while running.
    void start(const std::string& root, uint64_t min_size_bytes);
    void cancel();

    ScanProgress progress();
    std::vector<DuplicateGroup> results();

private:
    void run(std::string root, uint64_t min_size_bytes);
    std::string hash_file(const fs::path& p, uint64_t size_hint);

    std::mutex mutex_;
    ScanProgress progress_;
    std::vector<DuplicateGroup> results_;
    std::atomic<bool> cancel_requested_{false};
};

inline std::string Scanner::hash_file(const fs::path& p, uint64_t /*size_hint*/) {
    std::ifstream f(p, std::ios::binary);
    if (!f) return "";
    picosha2::hash256_one_by_one hasher;
    std::vector<char> buf(1 << 16); // 64KB chunks, keeps memory flat for huge files
    while (f) {
        f.read(buf.data(), buf.size());
        std::streamsize got = f.gcount();
        if (got <= 0) break;
        hasher.process(buf.begin(), buf.begin() + got);
    }
    hasher.finish();
    return picosha2::get_hash_hex_string(hasher);
}

inline void Scanner::start(const std::string& root, uint64_t min_size_bytes) {
    cancel_requested_ = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        progress_ = ScanProgress{};
        results_.clear();
    }
    std::thread(&Scanner::run, this, root, min_size_bytes).detach();
}

inline void Scanner::cancel() { cancel_requested_ = true; }

inline ScanProgress Scanner::progress() {
    std::lock_guard<std::mutex> lock(mutex_);
    return progress_;
}

inline std::vector<DuplicateGroup> Scanner::results() {
    std::lock_guard<std::mutex> lock(mutex_);
    return results_;
}

inline void Scanner::run(std::string root, uint64_t min_size_bytes) {
    // Pass 1: walk the tree, group paths by size.
    //
    // Deliberately NOT using recursive_directory_iterator's throwing
    // increment (operator++) here. On Windows, folders like
    // C:\Users\<you>\Application Data, Cookies, My Documents, etc. are
    // legacy junction points that loop back into the same tree; the
    // standard library detects that and throws mid-iteration. A single
    // throw would previously abort the *entire* scan, returning zero
    // results even though 99% of the tree was scannable. Instead we walk
    // manually with a stack, using non-throwing error_code overloads
    // everywhere, and skip only the one problem folder rather than giving
    // up on the whole scan. We also explicitly avoid descending into
    // symlinks/junctions, which is what actually prevents the infinite
    // loop in the first place (rather than relying on the library's
    // (unreliable, and now removed) loop detection).
    std::unordered_map<uint64_t, std::vector<FileEntry>> by_size;
    std::vector<fs::path> dirs_to_visit;
    dirs_to_visit.push_back(fs::path(root));

    while (!dirs_to_visit.empty()) {
        if (cancel_requested_) {
            std::lock_guard<std::mutex> lock(mutex_);
            progress_.status = ScanStatus::CANCELLED;
            return;
        }

        fs::path dir = dirs_to_visit.back();
        dirs_to_visit.pop_back();

        std::error_code open_ec;
        fs::directory_iterator dir_it(
            dir, fs::directory_options::skip_permission_denied, open_ec);
        if (open_ec) continue; // can't open this one folder — skip it, keep going
        fs::directory_iterator end_it;

        while (dir_it != end_it) {
            if (cancel_requested_) {
                std::lock_guard<std::mutex> lock(mutex_);
                progress_.status = ScanStatus::CANCELLED;
                return;
            }

            const auto& entry = *dir_it;

            std::error_code symlink_ec;
            bool is_symlink = entry.is_symlink(symlink_ec);

            if (!symlink_ec && is_symlink) {
                // Don't follow symlinks/junctions — this is what avoids
                // the self-referential-folder infinite loop, and also
                // means we never accidentally scan way outside the
                // folder the user actually asked for.
            } else {
                std::error_code type_ec;
                if (entry.is_directory(type_ec) && !type_ec) {
                    dirs_to_visit.push_back(entry.path());
                } else {
                    std::error_code file_ec;
                    if (entry.is_regular_file(file_ec) && !file_ec) {
                        std::error_code size_ec;
                        uint64_t size = entry.file_size(size_ec);
                        if (!size_ec && size >= min_size_bytes) {
                            FileEntry fe;
                            fe.path = entry.path().string();
                            fe.filename = entry.path().filename().string();
                            fe.size_bytes = size;
                            fe.extension = entry.path().extension().string();
                            for (auto& c : fe.extension) c = static_cast<char>(tolower(c));
                            fe.modified_unix = file_time_to_unix(entry.path());

                            by_size[size].push_back(fe);

                            std::lock_guard<std::mutex> lock(mutex_);
                            progress_.files_seen++;
                            progress_.current_path = fe.path;
                        }
                    }
                }
            }

            std::error_code inc_ec;
            dir_it.increment(inc_ec);
            if (inc_ec) break; // stop iterating *this* folder, move to the next one on the stack
        }
    }

    // Only size groups with 2+ files can possibly contain duplicates.
    std::vector<std::pair<uint64_t, std::vector<FileEntry>>> candidates;
    uint64_t candidate_count = 0;
    for (auto& [size, files] : by_size) {
        if (files.size() >= 2) {
            candidate_count += files.size();
            candidates.emplace_back(size, std::move(files));
        }
    }
    {
        std::lock_guard<std::mutex> lock(mutex_);
        progress_.candidates = candidate_count;
    }

    // Pass 2: hash same-size files, group by hash. This is the expensive
    // part; a production version would parallelize across a thread pool
    // (std::thread per chunk of `candidates`, or a work queue) — left as a
    // straightforward extension point once the single-threaded version is
    // validated to be correct.
    std::unordered_map<std::string, DuplicateGroup> by_hash;

    for (auto& [size, files] : candidates) {
        for (auto& fe : files) {
            if (cancel_requested_) {
                std::lock_guard<std::mutex> lock(mutex_);
                progress_.status = ScanStatus::CANCELLED;
                return;
            }
            std::string h = hash_file(fe.path, size);
            if (h.empty()) continue; // unreadable file, skip

            auto& group = by_hash[h];
            group.hash = h;
            group.size_bytes = size;
            group.files.push_back(fe);

            std::lock_guard<std::mutex> lock(mutex_);
            progress_.files_hashed++;
            progress_.bytes_hashed += size;
            progress_.current_path = fe.path;
        }
    }

    std::vector<DuplicateGroup> final_groups;
    for (auto& [hash, group] : by_hash) {
        if (group.files.size() >= 2) {
            final_groups.push_back(std::move(group));
        }
    }

    std::lock_guard<std::mutex> lock(mutex_);
    results_ = std::move(final_groups);
    progress_.status = ScanStatus::DONE;
}

} // namespace dupfinder
