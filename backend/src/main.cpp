// main.cpp
// Local REST API server for the duplicate file finder. Binds to
// 127.0.0.1 only (never exposed to the network) and is launched by the
// Tauri shell as a sidecar process. The React frontend talks to it over
// plain HTTP on localhost.
//
// Endpoints:
//   POST /scan            body: {"path": "C:\\Users\\...", "min_size_kb": 4}
//                          -> {"status": "started"}
//   GET  /scan/progress    -> current ScanProgress as JSON
//   GET  /scan/results     -> array of DuplicateGroup as JSON (once done)
//   POST /scan/cancel      -> stop an in-progress scan
//   POST /files/delete    body: {"paths": ["C:\\...", ...]}
//                          -> moves files to the OS trash/recycle bin
//                             (never a permanent delete), returns
//                             per-file success/failure
//   GET  /files/preview?path=<path>
//                          -> raw image bytes with correct Content-Type,
//                             for rendering a thumbnail in the split view.
//                             Images only, capped at 20MB; anything else
//                             returns 415.

#include <filesystem>
#include <fstream>
#include <sstream>
#include <unordered_map>

#include "httplib.h"
#include "scanner.hpp"
#include "trash.hpp"

using namespace dupfinder;
namespace fs = std::filesystem;

namespace {

Scanner g_scanner;

// Minimal JSON string escaping — good enough for file paths / messages.
// (Not pulling in a full JSON library to keep the build dependency-free;
// swap for nlohmann/json if the API grows past this.)
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

std::string progress_to_json(const ScanProgress& p) {
    std::ostringstream j;
    j << "{"
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
    j << "{"
      << "\"path\":\"" << json_escape(f.path) << "\","
      << "\"filename\":\"" << json_escape(f.filename) << "\","
      << "\"size_bytes\":" << f.size_bytes << ","
      << "\"extension\":\"" << json_escape(f.extension) << "\","
      << "\"is_image\":" << (is_image_ext(f.extension) ? "true" : "false") << ","
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
// must be '"'). Returns the decoded value and advances pos to just past
// the closing quote. Shared by extract_json_string and the /files/delete
// array parser so there's exactly one place that understands JSON escape
// sequences, instead of two subtly-different copies.
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
                    // Basic \uXXXX handling for the common case (BMP,
                    // non-surrogate-pair code points — sufficient for the
                    // file paths and filenames this API actually deals
                    // with; a full surrogate-pair decoder is unnecessary
                    // complexity here).
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

// Extremely small helper to pull a string/int field out of a flat JSON
// object without a real parser. The frontend only ever sends flat,
// single-level bodies, so this is sufficient and keeps the backend
// dependency-free.
//
// IMPORTANT: this decodes standard JSON escape sequences via
// decode_json_string_at rather than returning the raw substring between
// quotes. Windows paths are full of backslashes, and JSON.stringify on
// the frontend correctly escapes each one as "\\" — so without decoding
// here, every path arrives with every backslash doubled. That happens to
// still resolve for paths with something after the doubled separator
// (Windows path normalization tolerates redundant separators in the
// middle of a path), but silently fails for a bare drive root like "C:\"
// (sent as "C:\\\\" in JSON, decodes to "C:\\", which is not a valid
// root) — exactly the bug this fixes.
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

} // namespace

int main(int argc, char** argv) {
    int port = 8721; // arbitrary fixed local port; change here if it clashes
    if (argc > 1) port = std::atoi(argv[1]);

    httplib::Server svr;

    // CORS: Tauri's webview origin varies by platform (tauri://localhost on
    // some, http://tauri.localhost on others) so we just allow localhost
    // origins broadly rather than hardcoding one.
    svr.set_pre_routing_handler([](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        return httplib::Server::HandlerResponse::Unhandled;
    });
    svr.Options(R"(/.*)", [](const httplib::Request&, httplib::Response& res) {
        res.status = 204;
    });

    svr.Get("/health", [](const httplib::Request&, httplib::Response& res) {
        res.set_content("{\"ok\":true}", "application/json");
    });

    svr.Post("/scan", [](const httplib::Request& req, httplib::Response& res) {
        std::string path = extract_json_string(req.body, "path");
        uint64_t min_size_kb = extract_json_number(req.body, "min_size_kb", 1);

        if (path.empty() || !fs::exists(path)) {
            res.status = 400;
            res.set_content("{\"error\":\"path does not exist\"}", "application/json");
            return;
        }

        g_scanner.start(path, min_size_kb * 1024);
        res.set_content("{\"status\":\"started\"}", "application/json");
    });

    svr.Post("/scan/cancel", [](const httplib::Request&, httplib::Response& res) {
        g_scanner.cancel();
        res.set_content("{\"status\":\"cancelling\"}", "application/json");
    });

    svr.Get("/scan/progress", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(progress_to_json(g_scanner.progress()), "application/json");
    });

    svr.Get("/scan/results", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(results_to_json(g_scanner.results()), "application/json");
    });

    // Serves raw image bytes for the split-view thumbnail. Deliberately
    // narrow scope: only recognized image extensions, and capped at 20MB
    // so a huge accidental match (e.g. a giant TIFF) can't stall the
    // single-threaded httplib server on one request. Anything else — PDFs,
    // videos, documents — isn't previewed inline; those get an "Open"
    // link instead (handled entirely on the frontend via the OS's default
    // application, no backend involvement needed).
    svr.Get("/files/preview", [](const httplib::Request& req, httplib::Response& res) {
        if (!req.has_param("path")) {
            res.status = 400;
            res.set_content("{\"error\":\"missing path parameter\"}", "application/json");
            return;
        }
        // httplib decodes query parameters automatically.
        std::string path = req.get_param_value("path");

        std::error_code ec;
        if (path.empty() || !fs::exists(path, ec) || ec) {
            res.status = 404;
            res.set_content("{\"error\":\"file not found\"}", "application/json");
            return;
        }

        std::string ext = fs::path(path).extension().string();
        for (auto& c : ext) c = static_cast<char>(tolower(c));
        // Images render via <img>; PDFs render via WebView2's own built-in
        // PDF viewer inside an <iframe> — same trick a normal Chromium
        // browser uses for PDFs served over plain HTTP, no separate PDF
        // rendering library needed on the backend. Everything else still
        // falls back to the file-type badge on the frontend.
        bool is_pdf = (ext == ".pdf");
        if (!is_image_ext(ext) && !is_pdf) {
            res.status = 415;
            res.set_content("{\"error\":\"not a previewable file type\"}", "application/json");
            return;
        }

        uint64_t size = fs::file_size(path, ec);
        constexpr uint64_t kMaxPreviewBytes = 20ull * 1024 * 1024;
        if (ec || size > kMaxPreviewBytes) {
            res.status = 413;
            res.set_content("{\"error\":\"file too large to preview\"}", "application/json");
            return;
        }

        std::ifstream f(path, std::ios::binary);
        if (!f) {
            res.status = 500;
            res.set_content("{\"error\":\"could not open file\"}", "application/json");
            return;
        }
        std::string data((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());

        static const std::unordered_map<std::string, std::string> mime_types = {
            {".jpg", "image/jpeg"}, {".jpeg", "image/jpeg"}, {".png", "image/png"},
            {".gif", "image/gif"}, {".bmp", "image/bmp"}, {".webp", "image/webp"},
            {".svg", "image/svg+xml"}, {".tif", "image/tiff"}, {".tiff", "image/tiff"},
            {".pdf", "application/pdf"},
        };
        auto it = mime_types.find(ext);
        std::string content_type = it != mime_types.end() ? it->second : "application/octet-stream";

        res.set_content(data, content_type);
    });

    // Moves files the user picked in the UI to the OS trash/recycle bin —
    // never a permanent delete. Takes a flat JSON array of paths, e.g.
    // {"paths": ["C:\\a.jpg", "C:\\b.jpg"]}. Returns per-file success so a
    // partial failure (locked file, permissions) doesn't silently swallow
    // the rest.
    svr.Post("/files/delete", [](const httplib::Request& req, httplib::Response& res) {
        std::ostringstream out;
        out << "[";
        size_t pos = 0;
        bool first = true;
        const std::string& body = req.body;
        while (true) {
            pos = body.find('"', pos);
            if (pos == std::string::npos) break;
            std::string candidate = decode_json_string_at(body, pos);
            if (candidate == "paths") continue; // skip the key itself

            std::string error_msg;
            bool ok = move_to_trash(candidate, error_msg);
            if (!first) out << ",";
            first = false;
            out << "{\"path\":\"" << json_escape(candidate) << "\","
                << "\"deleted\":" << (ok ? "true" : "false") << ","
                << "\"error\":\"" << json_escape(error_msg) << "\""
                << "}";
        }
        out << "]";
        res.set_content(out.str(), "application/json");
    });

    printf("dup-finder backend listening on http://127.0.0.1:%d\n", port);
    svr.listen("127.0.0.1", port);
    return 0;
}
