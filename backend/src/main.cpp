// main.cpp
// One-shot CLI backend for the duplicate file finder. This process is
// spawned by the Tauri shell once PER OPERATION, does exactly one job,
// writes JSON to stdout, and exits. There is no HTTP server, no port, no
// persistent process, and nothing for the shell to clean up on close --
// the process's own exit IS the cleanup.
//
// Invocation: the subcommand is argv[1]; any parameters come as a single
// line of JSON on stdin (the Rust shell writes "<json>\n"). Reading one
// line (not slurping to EOF) means the caller never has to close stdin --
// which matters for `scan`, whose stdin stays open afterwards to receive a
// later "cancel" line.
//
//   trial-status        (no stdin)      -> {"licensed":..,"expired":..,...}
//   activate-license    {"key":"..."}   -> {"success":true} | {"success":false,"error":".."}
//   delete              {"paths":[...]} -> [{"path":..,"deleted":..,"error":..}, ...]
//   scan                {"path":"..","min_size_kb":..,"skip_*":..}
//                        -> streams one JSON line per progress tick
//                           ({"type":"progress",...}), then one final
//                           ({"type":"results","groups":[...]}) line.
//                        Send a line "cancel" on stdin to stop it early.
//
// File preview is deliberately NOT here anymore: the webview loads local
// files directly via Tauri's asset protocol (convertFileSrc) instead of
// pulling bytes through this backend. See the frontend for that change.

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_set>
#include <vector>

#include "license.hpp"
#include "scanner.hpp"
#include "trash.hpp"
#include "trial.hpp"

using namespace dupfinder;
namespace fs = std::filesystem;

namespace {

// Loaded once at process start. Because each op is its own short-lived
// process, "once at start" is simply "once" -- but the trial clock is
// based on the first-run timestamp stored on disk, not on process uptime,
// so this can't be gamed by relaunching.
TrialState g_trial_state = load_or_create_trial_state();
bool g_licensed = has_valid_saved_license();
Scanner g_scanner;

// Extensions treated as previewable plain text. Deliberately an allowlist
// rather than "anything not otherwise recognized" -- some text-adjacent
// extensions (.class, .jar) are actually compiled binaries and would
// render as garbage. Still used to set the is_text flag on each file.
bool is_text_ext(const std::string& ext) {
    static const std::unordered_set<std::string> text_exts = {
        ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".xml",
        ".yaml", ".yml", ".ini", ".cfg", ".conf", ".toml", ".env",
        ".java", ".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".less",
        ".html", ".htm", ".c", ".cpp", ".cc", ".h", ".hpp", ".cs", ".go", ".rs",
        ".rb", ".php", ".sh", ".bash", ".ps1", ".bat", ".sql", ".gradle",
        ".properties", ".gitattributes", ".editorconfig",
    };
    return text_exts.count(ext) > 0;
}

// Minimal JSON string escaping -- good enough for file paths / messages.
std::string json_escape(const std::string& s) {
    std::ostringstream out;
    for (char c : s) {
        switch (c) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out << buf;
                } else {
                    out << c;
                }
        }
    }
    return out.str();
}

std::string status_to_string(ScanStatus s) {
    switch (s) {
        case ScanStatus::RUNNING: return "running";
        case ScanStatus::DONE: return "done";
        case ScanStatus::FAILED: return "error";
        case ScanStatus::CANCELLED: return "cancelled";
    }
    return "unknown";
}

// A single streamed progress line. The "type" discriminator lets the
// frontend tell progress ticks apart from the final results payload, since
// both now arrive on the same stdout stream instead of separate endpoints.
std::string progress_to_json(const ScanProgress& p) {
    std::ostringstream j;
    j << "{"
      << "\"type\":\"progress\","
      << "\"status\":\"" << status_to_string(p.status) << "\","
      << "\"files_seen\":" << p.files_seen << ","
      << "\"files_hashed\":" << p.files_hashed << ","
      << "\"candidates\":" << p.candidates << ","
      << "\"bytes_hashed\":" << p.bytes_hashed << ","
      << "\"current_path\":\"" << json_escape(p.current_path) << "\","
      << "\"error_message\":\"" << json_escape(p.error_message) << "\""
      << "}";
    return j.str();
}

std::string file_entry_to_json(const FileEntry& f) {
    std::ostringstream j;
    std::string ext_lower = f.extension;
    for (auto& c : ext_lower) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
    j << "{"
      << "\"path\":\"" << json_escape(f.path) << "\","
      << "\"filename\":\"" << json_escape(f.filename) << "\","
      << "\"size_bytes\":" << f.size_bytes << ","
      << "\"extension\":\"" << json_escape(f.extension) << "\","
      << "\"is_image\":" << (is_image_ext(f.extension) ? "true" : "false") << ","
      << "\"is_text\":" << (is_text_ext(ext_lower) ? "true" : "false") << ","
      << "\"is_docx\":" << (ext_lower == ".docx" ? "true" : "false") << ","
      << "\"is_xlsx\":" << (ext_lower == ".xlsx" ? "true" : "false") << ","
      << "\"modified_unix\":" << f.modified_unix
      << "}";
    return j.str();
}

std::string results_to_json(const std::vector<DuplicateGroup>& groups) {
    std::ostringstream j;
    j << "[";
    for (size_t i = 0; i < groups.size(); i++) {
        const auto& g = groups[i];
        j << "{"
          << "\"hash\":\"" << json_escape(g.hash) << "\","
          << "\"size_bytes\":" << g.size_bytes << ","
          << "\"wasted_bytes\":" << (g.size_bytes * (g.files.size() - 1)) << ","
          << "\"files\":[";
        for (size_t k = 0; k < g.files.size(); k++) {
            j << file_entry_to_json(g.files[k]);
            if (k + 1 < g.files.size()) j << ",";
        }
        j << "]}";
        if (i + 1 < groups.size()) j << ",";
    }
    j << "]";
    return j.str();
}

// Decodes a JSON string literal starting at the opening quote (body[pos]
// must be '"'). Returns the decoded value and advances pos past the closing
// quote. Shared by extract_json_string and the delete-op array parser so
// there's exactly one place that understands JSON escapes.
//
// IMPORTANT: this is why the request is a JSON *object* on stdin rather
// than raw argv -- Windows paths are full of backslashes, JSON.stringify on
// the frontend escapes each one as "\\", and this is what decodes them back
// so a bare drive root like "C:\" survives round-trip intact.
std::string decode_json_string_at(const std::string& body, size_t& pos) {
    pos++; // move past the opening quote
    std::string result;
    while (pos < body.size() && body[pos] != '"') {
        if (body[pos] == '\\' && pos + 1 < body.size()) {
            char next = body[pos + 1];
            switch (next) {
                case '"':  result.push_back('"');  pos += 2; break;
                case '\\': result.push_back('\\'); pos += 2; break;
                case '/':  result.push_back('/');  pos += 2; break;
                case 'n':  result.push_back('\n'); pos += 2; break;
                case 't':  result.push_back('\t'); pos += 2; break;
                case 'r':  result.push_back('\r'); pos += 2; break;
                case 'b':  result.push_back('\b'); pos += 2; break;
                case 'f':  result.push_back('\f'); pos += 2; break;
                case 'u': {
                    if (pos + 5 < body.size()) {
                        std::string hex = body.substr(pos + 2, 4);
                        unsigned int code = 0;
                        try { code = std::stoul(hex, nullptr, 16); } catch (...) {}
                        if (code < 0x80) {
                            result.push_back(static_cast<char>(code));
                        } else if (code < 0x800) {
                            result.push_back(static_cast<char>(0xC0 | (code >> 6)));
                            result.push_back(static_cast<char>(0x80 | (code & 0x3F)));
                        } else {
                            result.push_back(static_cast<char>(0xE0 | (code >> 12)));
                            result.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
                            result.push_back(static_cast<char>(0x80 | (code & 0x3F)));
                        }
                        pos += 6;
                    } else {
                        pos += 2;
                    }
                    break;
                }
                default:
                    result.push_back(next);
                    pos += 2;
            }
        } else {
            result.push_back(body[pos]);
            pos++;
        }
    }
    if (pos < body.size()) pos++; // move past the closing quote
    return result;
}

std::string extract_json_string(const std::string& body, const std::string& key) {
    std::string needle = "\"" + key + "\"";
    auto pos = body.find(needle);
    if (pos == std::string::npos) return "";
    pos = body.find(':', pos);
    if (pos == std::string::npos) return "";
    pos = body.find('"', pos);
    if (pos == std::string::npos) return "";
    return decode_json_string_at(body, pos);
}

uint64_t extract_json_number(const std::string& body, const std::string& key, uint64_t fallback) {
    std::string needle = "\"" + key + "\"";
    auto pos = body.find(needle);
    if (pos == std::string::npos) return fallback;
    pos = body.find(':', pos);
    if (pos == std::string::npos) return fallback;
    pos++;
    while (pos < body.size() && isspace(static_cast<unsigned char>(body[pos]))) pos++;
    size_t end = pos;
    while (end < body.size() && (isdigit(static_cast<unsigned char>(body[end])))) end++;
    if (end == pos) return fallback;
    return std::stoull(body.substr(pos, end - pos));
}

bool extract_json_bool(const std::string& body, const std::string& key, bool fallback) {
    std::string needle = "\"" + key + "\"";
    auto pos = body.find(needle);
    if (pos == std::string::npos) return fallback;
    pos = body.find(':', pos);
    if (pos == std::string::npos) return fallback;
    pos++;
    while (pos < body.size() && isspace(static_cast<unsigned char>(body[pos]))) pos++;
    if (body.compare(pos, 4, "true") == 0) return true;
    if (body.compare(pos, 5, "false") == 0) return false;
    return fallback;
}

// Reads a single line (one JSON request) from stdin. Requests are one line
// each; a line read -- unlike slurping to EOF -- doesn't require the caller
// to close stdin, which the scan op relies on (it keeps stdin open for a
// later "cancel").
std::string read_request_line() {
    std::string line;
    std::getline(std::cin, line);
    return line;
}

std::string trial_status_to_json() {
    int remaining = trial_days_remaining(g_trial_state);
    bool expired = trial_is_expired(g_trial_state);
    std::ostringstream j;
    j << "{"
      << "\"licensed\":" << (g_licensed ? "true" : "false") << ","
      << "\"expired\":" << (expired ? "true" : "false") << ","
      << "\"days_remaining\":" << remaining << ","
      << "\"trial_days\":" << kTrialDays
      << "}";
    return j.str();
}

// A pre-scan failure, shaped like a terminal progress tick so the frontend
// can surface it through the exact same code path as a normal finish.
void emit_error_progress(const std::string& msg) {
    std::cout << "{\"type\":\"progress\",\"status\":\"error\","
              << "\"files_seen\":0,\"files_hashed\":0,\"candidates\":0,"
              << "\"bytes_hashed\":0,\"current_path\":\"\","
              << "\"error_message\":\"" << json_escape(msg) << "\"}"
              << std::endl;
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: dupfinder_backend <scan|delete|trial-status|activate-license>\n";
        return 2;
    }
    const std::string cmd = argv[1];

    if (cmd == "trial-status") {
        std::cout << trial_status_to_json() << std::endl;
        return 0;
    }

    if (cmd == "activate-license") {
        const std::string body = read_request_line();
        const std::string key = extract_json_string(body, "key");
        if (!license_key_is_valid(key)) {
            std::cout << R"({"success":false,"error":"invalid license key"})" << std::endl;
            return 0;  // success:false rides in the JSON, not the exit code
        }
        if (!save_license_key(key)) {
            std::cout << R"({"success":false,"error":"could not save license"})" << std::endl;
            return 0;
        }
        // No in-memory "unlock" flag to flip: this process is about to exit.
        // The unlock lives on DISK now (save_license_key wrote it); the next
        // `trial-status` process reads it back via has_valid_saved_license()
        // at startup. State persists in files, not in a resident process --
        // that's the whole shift from the server model.
        std::cout << R"({"success":true})" << std::endl;
        return 0;
    }

    if (cmd == "delete") {
        // Body is {"paths":["C:\\a.jpg", ...]}. We walk every quoted string,
        // skip the "paths" key itself, and trash the rest -- reporting
        // per-file success so one locked/denied file doesn't sink the batch.
        const std::string body = read_request_line();
        std::cout << "[";
        size_t pos = 0;
        bool first = true;
        while (true) {
            pos = body.find('"', pos);
            if (pos == std::string::npos) break;
            std::string candidate = decode_json_string_at(body, pos);
            if (candidate == "paths") continue;  // the key, not a value

            std::string error_msg;
            bool ok = move_to_trash(candidate, error_msg);
            if (!first) std::cout << ",";
            first = false;
            std::cout << "{\"path\":\"" << json_escape(candidate) << "\","
                      << "\"deleted\":" << (ok ? "true" : "false") << ","
                      << "\"error\":\"" << json_escape(error_msg) << "\"}";
        }
        std::cout << "]" << std::endl;
        return 0;
    }

    if (cmd == "scan") {
        const std::string body = read_request_line();
        std::string path = extract_json_string(body, "path");
        uint64_t min_size_kb = extract_json_number(body, "min_size_kb", 1);

        ScanOptions options;
        options.skip_hidden_system = extract_json_bool(body, "skip_hidden_system", true);
        options.skip_system_folders = extract_json_bool(body, "skip_system_folders", true);
        options.skip_dev_noise = extract_json_bool(body, "skip_dev_noise", false);

        // Same gate the old /scan endpoint enforced, server-side.
        if (!g_licensed && trial_is_expired(g_trial_state)) {
            emit_error_progress("trial expired");
            return 0;
        }
        if (path.empty() || !fs::exists(path)) {
            emit_error_progress("path does not exist");
            return 0;
        }

        // Watch stdin for a "cancel" line on a background thread. The first
        // stdin line (the params, read above) is already consumed, so this
        // thread only ever sees lines sent *after* the scan begins.
        // Detached: when the scan finishes normally this thread is still
        // blocked in getline, and the process exit tears it down cleanly.
        std::thread([] {
            std::string line;
            while (std::getline(std::cin, line)) {
                if (line == "cancel") {
                    g_scanner.cancel();
                    break;
                }
            }
        }).detach();

        g_scanner.start(path, min_size_kb * 1024, options);

        // Observe the (unchanged) engine and stream a progress line each
        // tick until it leaves RUNNING. We poll the engine here rather than
        // refactoring Scanner to push callbacks -- deliberately the
        // lower-churn choice, since the scan engine is the hard-won part we
        // don't want to disturb. Scanner sets results_ and the terminal
        // status under one lock, so once we observe a non-RUNNING status the
        // results are guaranteed already populated.
        for (;;) {
            ScanProgress p = g_scanner.progress();
            std::cout << progress_to_json(p) << std::endl;
            if (p.status != ScanStatus::RUNNING) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(150));
        }

        std::cout << "{\"type\":\"results\",\"groups\":"
                  << results_to_json(g_scanner.results()) << "}" << std::endl;
        return 0;
    }

    std::cerr << "unknown subcommand: " << cmd << "\n";
    return 2;
}
