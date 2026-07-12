#pragma once
// trash.hpp — moves a file to the OS trash/recycle bin instead of deleting
// it permanently. Each platform has a genuinely different mechanism; there
// is no portable standard library call for this, so we branch per-OS.
//
//   Windows: SHFileOperationW with FOF_ALLOWUNDO — this is the exact
//            mechanism Explorer itself uses for "Delete", so files land in
//            the real Recycle Bin and are restorable from there.
//   macOS:   shells out to `osascript` and asks Finder to delete the file,
//            which uses Finder's actual Trash — restorable from there.
//   Linux:   implements the freedesktop.org Trash spec (used by GNOME
//            Files, KDE Dolphin, etc.) — moves the file into
//            ~/.local/share/Trash/files and writes a matching .trashinfo
//            sidecar so file managers show it with its original path and
//            deletion time. Included mainly so this is testable end-to-end
//            while developing in WSL, and works if you ever ship a Linux
//            build.

#include <ctime>
#include <filesystem>
#include <fstream>
#include <string>

#if defined(_WIN32)
#include <shellapi.h>
#include <windows.h>
#elif defined(__APPLE__)
#include <cstdlib>
#include <sstream>
#endif

namespace dupfinder {

namespace fs = std::filesystem;

#if defined(_WIN32)

inline bool move_to_trash(const std::string& path, std::string& error_out) {
    // SHFileOperationW wants a double-null-terminated wide string.
    std::wstring wpath(path.begin(), path.end());
    wpath.push_back(L'\0');
    wpath.push_back(L'\0');

    SHFILEOPSTRUCTW op{};
    op.wFunc = FO_DELETE;
    op.pFrom = wpath.c_str();
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI;

    int result = SHFileOperationW(&op);
    if (result != 0 || op.fAnyOperationsAborted) {
        error_out = "SHFileOperation failed (code " + std::to_string(result) + ")";
        return false;
    }
    return true;
}

#elif defined(__APPLE__)

inline bool move_to_trash(const std::string& path, std::string& error_out) {
    // Escape for embedding inside an AppleScript string literal.
    std::string escaped;
    for (char c : path) {
        if (c == '\\' || c == '"') escaped.push_back('\\');
        escaped.push_back(c);
    }

    std::ostringstream cmd;
    cmd << "osascript -e 'tell application \"Finder\" to delete POSIX file \""
        << escaped << "\"' 2>&1";

    FILE* pipe = popen(cmd.str().c_str(), "r");
    if (!pipe) {
        error_out = "failed to launch osascript";
        return false;
    }
    std::string output;
    char buf[256];
    while (fgets(buf, sizeof(buf), pipe)) output += buf;
    int status = pclose(pipe);

    if (status != 0) {
        error_out = output.empty() ? "osascript returned non-zero" : output;
        return false;
    }
    return true;
}

#else // Linux / freedesktop Trash spec

inline std::string xdg_trash_home() {
    const char* xdg_data_home = std::getenv("XDG_DATA_HOME");
    fs::path base = xdg_data_home && *xdg_data_home
        ? fs::path(xdg_data_home)
        : fs::path(std::getenv("HOME") ? std::getenv("HOME") : "/tmp") / ".local" / "share";
    return (base / "Trash").string();
}

inline std::string iso8601_now() {
    std::time_t t = std::time(nullptr);
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", std::localtime(&t));
    return buf;
}

inline std::string url_encode_path(const std::string& path) {
    // .trashinfo files store the original path as a partial URI; only
    // characters outside the unreserved set need escaping.
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : path) {
        if (isalnum(c) || c == '/' || c == '-' || c == '_' || c == '.' || c == '~') {
            out.push_back(c);
        } else {
            out.push_back('%');
            out.push_back(hex[c >> 4]);
            out.push_back(hex[c & 0xF]);
        }
    }
    return out;
}

inline bool move_to_trash(const std::string& path, std::string& error_out) {
    std::error_code ec;
    fs::path src(path);
    if (!fs::exists(src, ec)) {
        error_out = "file does not exist";
        return false;
    }

    fs::path trash_home = xdg_trash_home();
    fs::path files_dir = trash_home / "files";
    fs::path info_dir = trash_home / "info";
    fs::create_directories(files_dir, ec);
    fs::create_directories(info_dir, ec);

    // Avoid collisions if a same-named file was already trashed.
    std::string base_name = src.filename().string();
    fs::path dest = files_dir / base_name;
    fs::path info_path = info_dir / (base_name + ".trashinfo");
    int suffix = 1;
    while (fs::exists(dest, ec) || fs::exists(info_path, ec)) {
        std::string candidate = src.stem().string() + "_" + std::to_string(suffix) + src.extension().string();
        dest = files_dir / candidate;
        info_path = info_dir / (candidate + ".trashinfo");
        suffix++;
    }

    fs::rename(src, dest, ec);
    if (ec) {
        // rename() fails across filesystems/mounts (common in WSL, e.g.
        // /mnt/c -> home). Fall back to copy + remove original.
        fs::copy_file(src, dest, fs::copy_options::overwrite_existing, ec);
        if (ec) {
            error_out = "could not move file to trash: " + ec.message();
            return false;
        }
        fs::remove(src, ec);
    }

    std::ofstream info(info_path);
    if (info) {
        info << "[Trash Info]\n"
             << "Path=" << url_encode_path(fs::absolute(src, ec).string()) << "\n"
             << "DeletionDate=" << iso8601_now() << "\n";
    }

    return true;
}

#endif

} // namespace dupfinder
