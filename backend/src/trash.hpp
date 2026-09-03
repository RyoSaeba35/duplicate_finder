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
#include <objbase.h>
#elif defined(__APPLE__)
#include <cstdlib>
#include <sstream>
#endif

namespace dupfinder {

namespace fs = std::filesystem;

#if defined(_WIN32)

// Converts a UTF-8 std::string to a proper UTF-16 std::wstring using the
// actual Windows conversion API. This matters: a naive per-byte widening
// (copying each char directly into a wchar_t) only happens to work for
// pure ASCII. Any real Unicode -- accented characters, typographic
// punctuation like a curly apostrophe, anything outside ASCII -- is
// multi-byte in UTF-8, and copying those bytes one-for-one into wide
// characters produces garbage that doesn't correspond to the actual
// filename at all. Confirmed directly: a file named with a French
// accented character and a curly apostrophe failed to delete with
// "file not found" (SHFileOperation error 2) purely because the naive
// conversion corrupted the path before Windows ever saw it -- the file
// existed the whole time, it just was never being asked for correctly.
inline std::wstring utf8_to_wide(const std::string& utf8) {
    if (utf8.empty()) return std::wstring();
    int size_needed = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(),
                                            static_cast<int>(utf8.size()), nullptr, 0);
    if (size_needed <= 0) return std::wstring();
    std::wstring wide(static_cast<size_t>(size_needed), 0);
    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()),
                         &wide[0], size_needed);
    return wide;
}

inline bool move_to_trash(const std::string& path, std::string& error_out) {
    // SHFileOperationW's FOF_ALLOWUNDO path uses COM internally (it's the
    // Shell's own file-operation engine, the same one Explorer's Recycle
    // Bin delete uses). httplib serves requests on a pool of worker
    // threads that get reused across many requests -- if a thread was
    // never CoInitialize'd, or was left in an inconsistent COM state from
    // an earlier call, SHFileOperationW can hang indefinitely on a LATER
    // call from that same reused thread, even though an earlier call
    // from it worked fine (exactly the "first delete works, second one
    // hangs" pattern this fixes). Since we can't control which thread
    // httplib hands us or predict its COM history, we make no
    // assumptions: initialize and clean up COM explicitly on every
    // single call, treating each one as fully self-contained.
    HRESULT com_result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    // S_OK: we initialized it fresh. S_FALSE: already initialized (on
    // this thread) with the same threading model -- either way we now
    // hold a reference and must release it with CoUninitialize.
    // RPC_E_CHANGED_MODE means this thread already has COM initialized
    // with a DIFFERENT threading model than we asked for; we did NOT
    // add a new reference in that case, so we must NOT call
    // CoUninitialize (that would wrongly decrement someone else's
    // reference count) -- COM is still usable regardless, so we proceed
    // with the operation either way.
    bool we_hold_com_reference = (com_result == S_OK || com_result == S_FALSE);

    std::wstring wpath = utf8_to_wide(path);
    wpath.push_back(L'\0');
    wpath.push_back(L'\0');

    SHFILEOPSTRUCTW op{};
    op.wFunc = FO_DELETE;
    op.pFrom = wpath.c_str();
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI;

    int result = SHFileOperationW(&op);
    bool ok = (result == 0 && !op.fAnyOperationsAborted);
    if (!ok) {
        error_out = "SHFileOperation failed (code " + std::to_string(result) + ")";
    }

    if (we_hold_com_reference) {
        CoUninitialize();
    }

    return ok;
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
