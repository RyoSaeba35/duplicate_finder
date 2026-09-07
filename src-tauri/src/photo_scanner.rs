// photo_scanner.rs — scan engine for Photographer Mode.
//
// Key differences from the general scanner:
//   • Only processes image and RAW files.
//   • Applies the same system/dev/hidden folder exclusions as scanner.rs
//     so a C:\ scan doesn't pick up Windows, Program Files, AppData etc.
//   • Detects RAW+JPEG pairs (same base name, different extension).
//   • Marks files tracked by an optional Lightroom catalog.

use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

const HASH_CHUNK_SIZE: usize = 20;

// ── Extension tables ──────────────────────────────────────────────────────────

const RAW_EXTENSIONS: &[&str] = &[
    ".cr2", ".cr3",          // Canon
    ".nef", ".nrw",          // Nikon
    ".arw", ".srf", ".sr2",  // Sony
    ".orf",                  // Olympus
    ".rw2",                  // Panasonic
    ".dng",                  // Adobe DNG
    ".raf",                  // Fujifilm
    ".pef",                  // Pentax
    ".srw",                  // Samsung
    ".3fr",                  // Hasselblad
    ".mef",                  // Mamiya
    ".rwl",                  // Leica
    ".kdc", ".dcr",          // Kodak
    ".mrw",                  // Minolta
    ".x3f",                  // Sigma
];

const JPEG_EXTENSIONS: &[&str] = &[".jpg", ".jpeg"];

const VIDEO_EXTENSIONS: &[&str] = &[
    ".mp4", ".mov", ".avi", ".mkv", ".m4v",
    ".mpg", ".mpeg", ".wmv", ".flv", ".webm",
    ".mts", ".m2ts",  // AVCHD — common from Sony/Panasonic cameras
    ".hevc",          // High Efficiency Video (newer cameras)
];

const ALL_IMAGE_EXTENSIONS: &[&str] = &[
    // Standard raster images
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp",
    ".heic", ".heif", ".tiff", ".tif",
    // RAW formats
    ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".srf", ".sr2",
    ".orf", ".rw2", ".dng", ".raf", ".pef", ".srw",
    ".3fr", ".mef", ".rwl", ".kdc", ".dcr", ".mrw", ".x3f",
    // Video
    ".mp4", ".mov", ".avi", ".mkv", ".m4v",
    ".mpg", ".mpeg", ".wmv", ".flv", ".webm",
    ".mts", ".m2ts", ".hevc",
];

fn is_image_ext(ext: &str) -> bool { ALL_IMAGE_EXTENSIONS.contains(&ext) }
fn is_video_ext(ext: &str) -> bool { VIDEO_EXTENSIONS.contains(&ext) }
fn is_raw_ext(ext: &str) -> bool   { RAW_EXTENSIONS.contains(&ext) }
fn is_jpeg_ext(ext: &str) -> bool  { JPEG_EXTENSIONS.contains(&ext) }

// ── Folder exclusion logic (mirrors scanner.rs) ───────────────────────────────
// Duplicated here rather than shared to keep scanner.rs changes minimal.
// These are the same lists maintained in scanner.rs.

fn is_system_folder(name: &str) -> bool {
    const NAMES: &[&str] = &[
        "windows", "programdata", "$recycle.bin",
        "system volume information", "recovery", "config.msi", "perflogs",
        "program files", "program files (x86)", "appdata", "windowsapps",
        "inetpub", "drivers",
    ];
    NAMES.contains(&name.to_lowercase().as_str())
}

fn is_dev_noise_folder(name: &str) -> bool {
    const NAMES: &[&str] = &[
        ".git", ".svn", ".hg", "node_modules", "vendor", ".venv", "venv",
        "target", "build", "dist", "bin", "obj", "__pycache__",
        ".cargo", ".npm", ".yarn", ".pnpm-store", ".m2", ".nuget",
        ".android", "packages", ".rustup", ".vscode",
        ".idea", ".vs", ".gradle", ".next", ".cache",
    ];
    NAMES.contains(&name.to_lowercase().as_str())
}

#[cfg(windows)]
fn has_hidden_or_system_attr(path: &Path) -> bool {
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
fn has_hidden_or_system_attr(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(false)
}

// ── Public types ──────────────────────────────────────────────────────────────


#[derive(Serialize, Clone)]
pub struct PhotoFileOut {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub extension: String,
    pub is_raw: bool,
    pub is_video: bool,
    pub lightroom_tracked: bool,
    pub modified_unix: i64,
}

#[derive(Serialize, Clone)]
pub struct PhotoDuplicateGroupOut {
    pub hash: String,
    pub size_bytes: u64,
    pub wasted_bytes: u64,
    pub files: Vec<PhotoFileOut>,
}

#[derive(Serialize, Clone)]
pub struct RawJpegPairOut {
    pub base_name: String,
    pub raw_file: PhotoFileOut,
    pub jpeg_file: PhotoFileOut,
}

#[derive(Serialize, Clone)]
pub struct PhotoScanResultsOut {
    pub exact_duplicates: Vec<PhotoDuplicateGroupOut>,
    pub raw_jpeg_pairs: Vec<RawJpegPairOut>,
    pub lightroom_tracked_count: usize,
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum PhotoScanEvent {
    #[serde(rename = "progress")]
    Progress {
        status: String,
        files_seen: u64,
        files_hashed: u64,
        candidates: u64,
        current_path: String,
        error_message: String,
    },
    #[serde(rename = "results")]
    Results(PhotoScanResultsOut),
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

fn is_tracked(path: &str, tracked: &HashSet<String>) -> bool {
    if tracked.is_empty() { return false; }
    tracked.contains(&path.replace('/', "\\").to_lowercase())
}

// ── Main scan entry point ─────────────────────────────────────────────────────

pub fn run_photo_scan(
    root: String,
    lightroom_catalog: Option<String>,
    cancel: Arc<AtomicBool>,
    mut emit: impl FnMut(PhotoScanEvent),
) {
    if !Path::new(&root).exists() {
        emit(PhotoScanEvent::Progress {
            status: "error".into(),
            files_seen: 0, files_hashed: 0, candidates: 0,
            current_path: String::new(),
            error_message: "path does not exist".into(),
        });
        return;
    }

    // Load Lightroom catalog — non-fatal if missing or invalid.
    let tracked: HashSet<String> = match lightroom_catalog {
        Some(ref p) if !p.trim().is_empty() => {
            crate::lightroom::read_tracked_paths(p).unwrap_or_default()
        }
        _ => HashSet::new(),
    };

    // ── Pass 1: walk, filter to image files ──────────────────────────────────
    // Uses manual iterator so we can call skip_current_dir() on system/dev folders,
    // exactly like scanner.rs does for the general mode.

    let mut files_seen: u64 = 0;
    let mut current_path = String::new();
    let mut all_files: Vec<PhotoFileOut> = Vec::new();
    let mut by_base: HashMap<String, Vec<usize>> = HashMap::new();

    let mut it = WalkDir::new(&root).follow_links(false).into_iter();
    loop {
        if cancel.load(Ordering::Relaxed) {
            emit(PhotoScanEvent::Progress {
                status: "cancelled".into(),
                files_seen, files_hashed: 0, candidates: 0,
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

        // Directory: apply the same exclusions as the general scanner.
        if file_type.is_dir() {
            if entry.depth() > 0 {
                let name = entry.file_name().to_string_lossy();
                let skip = is_system_folder(&name)
                    || is_dev_noise_folder(&name)
                    || has_hidden_or_system_attr(path);
                if skip {
                    it.skip_current_dir();
                }
            }
            continue;
        }

        if !file_type.is_file() { continue; }
        if has_hidden_or_system_attr(path) { continue; }

        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| format!(".{}", s.to_lowercase()))
            .unwrap_or_default();

        if !is_image_ext(&extension) { continue; }

        let size = match entry.metadata() {
            Ok(m) => m.len(),
            Err(_) => continue,
        };

        let filename = path.file_name()
            .and_then(|f| f.to_str())
            .unwrap_or_default()
            .to_string();

        let path_str = path.to_string_lossy().to_string();
        current_path = path_str.clone();
        files_seen += 1;

        let base = path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_lowercase();

        let idx = all_files.len();
        all_files.push(PhotoFileOut {
            path: path_str.clone(),
            filename,
            size_bytes: size,
            extension: extension.clone(),
            is_raw: is_raw_ext(&extension),
            is_video: is_video_ext(&extension),
            lightroom_tracked: is_tracked(&path_str, &tracked),
            modified_unix: modified_unix(path),
        });
        by_base.entry(base).or_default().push(idx);

        if files_seen % 50 == 0 {
            emit(PhotoScanEvent::Progress {
                status: "running".into(),
                files_seen, files_hashed: 0, candidates: 0,
                current_path: current_path.clone(), error_message: String::new(),
            });
        }
    }

    let lightroom_tracked_count = all_files.iter().filter(|f| f.lightroom_tracked).count();

    // ── RAW+JPEG pair detection ──────────────────────────────────────────────

    let mut raw_jpeg_pairs: Vec<RawJpegPairOut> = Vec::new();

    for (base_name, indices) in &by_base {
        let raws: Vec<&PhotoFileOut> = indices.iter()
            .map(|&i| &all_files[i])
            .filter(|f| is_raw_ext(&f.extension))
            .collect();
        let jpegs: Vec<&PhotoFileOut> = indices.iter()
            .map(|&i| &all_files[i])
            .filter(|f| is_jpeg_ext(&f.extension))
            .collect();

        if raws.is_empty() || jpegs.is_empty() { continue; }

        raw_jpeg_pairs.push(RawJpegPairOut {
            base_name: base_name.clone(),
            raw_file: raws[0].clone(),
            jpeg_file: jpegs[0].clone(),
        });
    }

    raw_jpeg_pairs.sort_by(|a, b| a.base_name.cmp(&b.base_name));

    // ── Pass 2: hash same-size candidates for exact duplicate detection ───────

    let mut by_size: HashMap<u64, Vec<PhotoFileOut>> = HashMap::new();
    for file in &all_files {
        by_size.entry(file.size_bytes).or_default().push(file.clone());
    }

    let mut candidate_count: u64 = 0;
    let mut flat: Vec<PhotoFileOut> = by_size
        .into_iter()
        .filter(|(_, files)| files.len() >= 2)
        .flat_map(|(_, files)| { candidate_count += files.len() as u64; files })
        .collect();

    emit(PhotoScanEvent::Progress {
        status: "running".into(),
        files_seen, files_hashed: 0, candidates: candidate_count,
        current_path: String::new(), error_message: String::new(),
    });

    let mut files_hashed: u64 = 0;
    let mut by_hash: HashMap<String, Vec<PhotoFileOut>> = HashMap::new();

    while !flat.is_empty() {
        if cancel.load(Ordering::Relaxed) {
            emit(PhotoScanEvent::Progress {
                status: "cancelled".into(),
                files_seen, files_hashed, candidates: candidate_count,
                current_path: String::new(), error_message: String::new(),
            });
            return;
        }

        let chunk_size = HASH_CHUNK_SIZE.min(flat.len());
        let chunk: Vec<PhotoFileOut> = flat.drain(..chunk_size).collect();

        let chunk_results: Vec<Option<(String, PhotoFileOut)>> = chunk
            .into_par_iter()
            .map(|fe| {
                if cancel.load(Ordering::Relaxed) { return None; }
                let hash = hash_file(&fe.path)?;
                Some((hash, fe))
            })
            .collect();

        for result in chunk_results.into_iter().flatten() {
            let (hash, fe) = result;
            files_hashed += 1;
            by_hash.entry(hash).or_default().push(fe);
        }

        emit(PhotoScanEvent::Progress {
            status: "running".into(),
            files_seen, files_hashed, candidates: candidate_count,
            current_path: String::new(), error_message: String::new(),
        });
    }

    let mut exact_duplicates: Vec<PhotoDuplicateGroupOut> = by_hash
        .into_iter()
        .filter(|(_, files)| files.len() >= 2)
        .map(|(hash, mut files)| {
            files.sort_by_key(|f| if f.modified_unix == 0 { i64::MAX } else { f.modified_unix });
            let size_bytes = files[0].size_bytes;
            let wasted_bytes = size_bytes * (files.len() as u64 - 1);
            PhotoDuplicateGroupOut { hash, size_bytes, wasted_bytes, files }
        })
        .collect();

    exact_duplicates.sort_by_key(|g| Reverse(g.wasted_bytes));

    emit(PhotoScanEvent::Progress {
        status: "done".into(),
        files_seen, files_hashed, candidates: candidate_count,
        current_path: String::new(), error_message: String::new(),
    });

    emit(PhotoScanEvent::Results(PhotoScanResultsOut {
        exact_duplicates,
        raw_jpeg_pairs,
        lightroom_tracked_count,
    }));
}
