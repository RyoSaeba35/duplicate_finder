// lightroom.rs — reads an Adobe Lightroom Classic catalog (.lrcat) to
// discover which files are currently tracked.
//
// Purpose: Photographer Mode flags any file Lightroom manages so the user
// cannot accidentally delete a photo that Lightroom is tracking. Deleting
// a tracked file causes Lightroom to show a "?" / "missing file" error on
// that image — all edits, star ratings, and collection membership are
// preserved in the catalog but the source file is gone.
//
// A .lrcat file is a plain SQLite database. The path of each tracked file
// is stored across three tables:
//   AgLibraryRootFolder  — absolute root paths  e.g. "C:/Users/Jazz/Photos/"
//   AgLibraryFolder      — relative path from root  e.g. "2023/Italy/"
//   AgLibraryFile        — filename  e.g. "DSC_0001.NEF"
//
// Full path = rootFolder.absolutePath + folder.pathFromRoot + file.idx_filename
//
// Lightroom stores paths with forward slashes. We normalise to lowercase
// backslash for case-insensitive comparison against Windows paths.

use rusqlite::{Connection, OpenFlags};
use std::collections::HashSet;

/// Opens a Lightroom catalog and returns the set of absolute paths it tracks,
/// normalised to lowercase backslash form for Windows path comparison.
///
/// Returns an error string if the catalog cannot be opened or queried —
/// callers treat this as non-fatal and simply disable Lightroom integration
/// for the scan rather than aborting.
pub fn read_tracked_paths(catalog_path: &str) -> Result<HashSet<String>, String> {
    // Open read-only — we never write to the catalog.
    let conn = Connection::open_with_flags(
        catalog_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("could not open Lightroom catalog: {e}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT
               r.absolutePath,
               f.pathFromRoot,
               fi.idx_filename
             FROM AgLibraryFile fi
             JOIN AgLibraryFolder f      ON fi.folder      = f.id_local
             JOIN AgLibraryRootFolder r  ON f.rootFolder   = r.id_local",
        )
        .map_err(|e| format!("catalog schema query failed: {e}"))?;

    let mut paths: HashSet<String> = HashSet::new();

    let rows = stmt
        .query_map([], |row| {
            let root: String = row.get(0)?;
            let folder: String = row.get(1)?;
            let file: String = row.get(2)?;
            Ok(format!("{root}{folder}{file}"))
        })
        .map_err(|e| format!("catalog row read failed: {e}"))?;

    for row in rows.flatten() {
        // Normalise: forward slash → backslash, then lowercase.
        let normalised = row.replace('/', "\\").to_lowercase();
        paths.insert(normalised);
    }

    Ok(paths)
}
