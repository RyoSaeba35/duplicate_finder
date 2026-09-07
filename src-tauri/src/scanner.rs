// scanner.rs — native Rust scan engine with parallel hashing via rayon.
//
// Two-pass approach:
//   Pass 1: walk the directory tree, group files by size (single-threaded).
//   Pass 2: hash same-size candidates using rayon for parallelism.
//           Processed in chunks of HASH_CHUNK_SIZE so progress events can
//           be emitted between chunks — giving live "X hashed" feedback
//           while still parallelising the CPU-bound SHA-256 work.

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

// Files per parallel batch. After each batch completes, one progress event
// is emitted. Smaller = more frequent updates but more overhead; 100 is a
// good balance — a scan with 5,000 candidates gets 50 progress ticks.
const HASH_CHUNK_SIZE: usize = 100;

fn default_true() -> bool { true }

#[derive(Deserialize, Clone)]
pub struct ScanOptions {
    #[serde(default = "default_true")]
    pub skip_hidden_system: bool,
    #[serde(default = "default_true")]
    pub skip_system_folders: bool,
    #[serde(default)]
    pub skip_dev_noise: bool,
    /// Only include files with these extensions e.g. [".jpg", ".pdf"].
    /// Empty = no filter, scan all extensions.
    #[serde(default)]
    pub extension_filter: Vec<String>,
    /// Absolute folder paths to skip entirely during the walk.
    /// Compared case-insensitively on Windows. Empty = no extra exclusions.
    #[serde(default)]
    pub excluded_folders: Vec<String>,
}

#[derive(Deserialize)]
pub struct ScanRequest {
    pub path: String,
    pub min_size_kb: u64,
    #[serde(flatten)]
    pub options: ScanOptions,
}

#[derive(Serialize, Clone)]
pub struct FileEntryOut {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub extension: String,
    pub is_image: bool,
    pub is_text: bool,
    pub is_docx: bool,
    pub is_xlsx: bool,
    pub modified_unix: i64,
}

#[derive(Serialize, Clone)]
pub struct DuplicateGroupOut {
    pub hash: String,
    pub size_bytes: u64,
    pub wasted_bytes: u64,
    pub files: Vec<FileEntryOut>,
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum ScanEvent {
    #[serde(rename = "progress")]
    Progress {
        status: String,
        files_seen: u64,
        files_hashed: u64,
        candidates: u64,
        bytes_hashed: u64,
        current_path: String,
        error_message: String,
    },
    #[serde(rename = "results")]
    Results { groups: Vec<DuplicateGroupOut> },
}

fn is_system_folder_name(name: &str) -> bool {
    const NAMES: &[&str] = &[
        // Core Windows system directories
        "windows", "programdata", "$recycle.bin",
        "system volume information", "recovery", "config.msi", "perflogs",
        // Application install directories — contain app-managed files, not user files.
        // Duplicates here (e.g. Edge DLLs across update folders, CMake versions) are
        // intentional versioned copies that the app manages; users should never delete them.
        "program files", "program files (x86)", "windowsapps",
        // User app data — browser caches, SDK headers, Python packages, pip cache etc.
        // Almost all duplicates here are noise: extension versions, NDK versions,
        // site-packages installed in multiple locations. Legitimate user files live in
        // Documents/Downloads/Desktop/Pictures, not AppData.
        "appdata",
        // Server / system tools — present on developer machines, never user files
        "inetpub",  // IIS web server root
        "drivers",  // device driver packages
    ];
    NAMES.contains(&name.to_lowercase().as_str())
}

fn is_dev_noise_folder_name(name: &str) -> bool {
    const NAMES: &[&str] = &[
        // Version control
        ".git", ".svn", ".hg",
        // Build output
        "target", "build", "dist", "bin", "obj",
        // Dependency installs
        "node_modules", "vendor", ".venv", "venv",
        // Package manager caches — identical files across projects/versions are
        // intentional caching, not user-recoverable duplicates.
        ".cargo",       // Rust: registry + compiled deps
        ".npm",         // npm global cache
        ".yarn",        // Yarn cache
        ".pnpm-store",  // pnpm content-addressable store
        ".m2",          // Maven local repository (jars duplicated across versions)
        ".nuget",       // NuGet global package cache
        ".android",     // Android SDK/AVD cache in home folder
        "packages",     // NuGet packages folder inside .NET solutions
        // Toolchain installs
        ".rustup",      // Rust toolchain docs, stdlib, tools
        ".vscode",      // VS Code extension files, typeshed stubs, etc.
        // IDE/tool state
        ".idea", ".vs", ".gradle", ".next", ".cache",
        // Python bytecode cache
        "__pycache__",
    ];
    NAMES.contains(&name.to_lowercase().as_str())
}

fn is_image_ext(ext: &str) -> bool {
    const EXTS: &[&str] = &[
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp",
        ".heic", ".tiff", ".tif", ".raw", ".svg",
    ];
    EXTS.contains(&ext)
}

fn is_text_ext(ext: &str) -> bool {
    const EXTS: &[&str] = &[
        ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log",
        ".xml", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".toml", ".env",
        ".java", ".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".scss",
        ".less", ".html", ".htm", ".c", ".cpp", ".cc", ".h", ".hpp",
        ".cs", ".go", ".rs", ".rb", ".php", ".sh", ".bash", ".ps1",
        ".bat", ".sql", ".gradle", ".properties", ".gitattributes", ".editorconfig",
    ];
    EXTS.contains(&ext)
}

#[cfg(windows)]
fn has_hidden_or_system_attribute(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
    match std::fs::metadata(path) {
        Ok(meta) => {
            let attrs = meta.file_attributes();
            (attrs & FILE_ATTRIBUTE_HIDDEN) != 0 || (attrs & FILE_ATTRIBUTE_SYSTEM) != 0
        }
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn has_hidden_or_system_attribute(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(false)
}

fn hash_file(path: &str) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1 << 16];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

fn modified_unix(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Returns true if `path` matches any of the user-defined excluded folders.
/// Comparison is case-insensitive and normalises backslash/forward-slash so
/// a path picked from the Windows dialog always matches regardless of separator.
fn is_user_excluded(path: &Path, excluded: &[String]) -> bool {
    if excluded.is_empty() { return false; }
    let path_str = path.to_string_lossy().to_lowercase().replace('/', "\\");
    excluded.iter().any(|excl| {
        excl.to_lowercase().replace('/', "\\") == path_str
    })
}

pub fn run_scan(
    root: String,
    min_size_bytes: u64,
    options: ScanOptions,
    cancel: Arc<AtomicBool>,
    mut emit: impl FnMut(ScanEvent),
) {
    if !Path::new(&root).exists() {
        emit(ScanEvent::Progress {
            status: "error".into(),
            files_seen: 0, files_hashed: 0, candidates: 0, bytes_hashed: 0,
            current_path: String::new(),
            error_message: "path does not exist".into(),
        });
        return;
    }

    // Lowercase the extension filter once for fast comparison.
    let ext_filter: Vec<String> = options.extension_filter.iter()
        .map(|s| {
            let s = s.trim().to_lowercase();
            if s.starts_with('.') { s } else { format!(".{}", s) }
        })
        .filter(|s| s.len() > 1)
        .collect();

    // ── Pass 1: walk tree, group by size ─────────────────────────────────────

    let mut files_seen: u64 = 0;
    let mut current_path = String::new();
    let mut by_size: HashMap<u64, Vec<FileEntryOut>> = HashMap::new();

    let mut it = WalkDir::new(&root).follow_links(false).into_iter();
    loop {
        if cancel.load(Ordering::Relaxed) {
            emit(ScanEvent::Progress {
                status: "cancelled".into(),
                files_seen, files_hashed: 0, candidates: 0, bytes_hashed: 0,
                current_path: current_path.clone(), error_message: String::new(),
            });
            return;
        }

        let entry = match it.next() {
            Some(Ok(e)) => e,
            Some(Err(_)) => continue,
            None => break,
        };

        let path = entry.path();
        let file_type = entry.file_type();

        if file_type.is_dir() {
            if entry.depth() > 0 {
                let name = entry.file_name().to_string_lossy();
                let mut skip = false;
                // User-defined exclusion list — checked first, full path match.
                if !skip && is_user_excluded(path, &options.excluded_folders) { skip = true; }
                // Built-in folder filters.
                if !skip && options.skip_system_folders && is_system_folder_name(&name) { skip = true; }
                if !skip && options.skip_dev_noise && is_dev_noise_folder_name(&name) { skip = true; }
                if !skip && options.skip_hidden_system && has_hidden_or_system_attribute(path) { skip = true; }
                if skip { it.skip_current_dir(); }
            }
            continue;
        }

        if !file_type.is_file() { continue; }
        if options.skip_hidden_system && has_hidden_or_system_attribute(path) { continue; }

        let size = match entry.metadata() {
            Ok(m) => m.len(),
            Err(_) => continue,
        };
        if size < min_size_bytes { continue; }

        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| format!(".{}", s.to_lowercase()))
            .unwrap_or_default();

        if !ext_filter.is_empty() && !ext_filter.contains(&extension) {
            continue;
        }

        let filename = path.file_name()
            .and_then(|f| f.to_str())
            .unwrap_or_default()
            .to_string();
        let path_str = path.to_string_lossy().to_string();

        current_path = path_str.clone();
        files_seen += 1;

        by_size.entry(size).or_default().push(FileEntryOut {
            path: path_str, filename, size_bytes: size, extension,
            is_image: false, is_text: false, is_docx: false, is_xlsx: false,
            modified_unix: modified_unix(path),
        });

        if files_seen % 50 == 0 {
            emit(ScanEvent::Progress {
                status: "running".into(),
                files_seen, files_hashed: 0, candidates: 0, bytes_hashed: 0,
                current_path: current_path.clone(), error_message: String::new(),
            });
        }
    }

    let mut candidate_count: u64 = 0;
    let mut flat: Vec<(u64, FileEntryOut)> = by_size
        .into_iter()
        .filter(|(_, files)| files.len() >= 2)
        .flat_map(|(size, files)| {
            candidate_count += files.len() as u64;
            files.into_iter().map(move |f| (size, f))
        })
        .collect();

    emit(ScanEvent::Progress {
        status: "running".into(),
        files_seen, files_hashed: 0, candidates: candidate_count,
        bytes_hashed: 0, current_path: String::new(), error_message: String::new(),
    });

    // ── Pass 2: parallel hashing in chunks ───────────────────────────────────
    //
    // We process HASH_CHUNK_SIZE files at a time using rayon's par_iter()
    // within each chunk. After each chunk completes we emit a progress event,
    // giving live "X hashed" feedback. The emit closure is not Send so it
    // cannot be called from inside par_iter — the chunked approach is the
    // cleanest way to keep both parallelism and progress reporting.

    let mut files_hashed: u64 = 0;
    let mut bytes_hashed: u64 = 0;
    let mut by_hash: HashMap<String, DuplicateGroupOut> = HashMap::new();

    while !flat.is_empty() {
        if cancel.load(Ordering::Relaxed) {
            emit(ScanEvent::Progress {
                status: "cancelled".into(),
                files_seen, files_hashed, candidates: candidate_count,
                bytes_hashed, current_path: String::new(), error_message: String::new(),
            });
            return;
        }

        // Drain up to HASH_CHUNK_SIZE owned items for this parallel batch.
        let chunk_size = HASH_CHUNK_SIZE.min(flat.len());
        let chunk: Vec<(u64, FileEntryOut)> = flat.drain(..chunk_size).collect();

        // Hash the chunk in parallel — each item is independent.
        let chunk_results: Vec<Option<(String, u64, FileEntryOut)>> = chunk
            .into_par_iter()
            .map(|(size, mut fe)| {
                if cancel.load(Ordering::Relaxed) { return None; }
                let hash = hash_file(&fe.path)?;
                fe.is_image = is_image_ext(&fe.extension);
                fe.is_text = is_text_ext(&fe.extension);
                fe.is_docx = fe.extension == ".docx";
                fe.is_xlsx = fe.extension == ".xlsx";
                Some((hash, size, fe))
            })
            .collect();

        // Update running totals and group by hash (sequential, fast).
        for result in chunk_results.into_iter().flatten() {
            let (hash, size, fe) = result;
            files_hashed += 1;
            bytes_hashed += size;
            let group = by_hash.entry(hash).or_insert_with(|| DuplicateGroupOut {
                hash: String::new(),
                size_bytes: size,
                wasted_bytes: 0,
                files: Vec::new(),
            });
            group.files.push(fe);
        }

        // Emit progress after every chunk so the UI stays live.
        emit(ScanEvent::Progress {
            status: "running".into(),
            files_seen, files_hashed, candidates: candidate_count,
            bytes_hashed, current_path: String::new(), error_message: String::new(),
        });
    }

    let mut final_groups: Vec<DuplicateGroupOut> = Vec::new();
    for (hash, mut group) in by_hash {
        if group.files.len() >= 2 {
            group.files.sort_by_key(|f| {
                if f.modified_unix == 0 { i64::MAX } else { f.modified_unix }
            });
            group.hash = hash;
            group.wasted_bytes = group.size_bytes * (group.files.len() as u64 - 1);
            final_groups.push(group);
        }
    }

    emit(ScanEvent::Progress {
        status: "done".into(),
        files_seen, files_hashed, candidates: candidate_count,
        bytes_hashed, current_path: String::new(), error_message: String::new(),
    });
    emit(ScanEvent::Results { groups: final_groups });
}
