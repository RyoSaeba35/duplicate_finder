// raw_preview.rs — extracts embedded JPEG previews from RAW camera files.
//
// Every modern camera RAW format (NEF, CR2, CR3, ARW, DNG, ORF, RAF, RW2,
// PEF, 3FR …) embeds at least one full-resolution or near-full-resolution
// JPEG preview inside the raw binary. The camera generates this JPEG at
// capture time so that software can show the photo instantly without
// decoding the proprietary RAW data.
//
// Strategy: scan the first SCAN_LIMIT bytes of the file for JPEG start
// markers (FF D8 FF). For each, scan forward for the end marker (FF D9).
// In valid JPEG streams, FF bytes inside compressed scan data are always
// stuffed as FF 00, so FF D9 only ever appears as the genuine EOI marker —
// the scan is reliable. We collect all complete JPEG blocks and return the
// largest one (the main preview, not the small EXIF thumbnail).
//
// Falls back gracefully: if no usable JPEG is found (e.g. very unusual RAW
// format), returns None and the frontend shows the extension badge instead.

use std::io::Read;

/// How many bytes to read before giving up. 10 MB covers embedded previews
/// in every common camera format, including Sony ARW and Adobe DNG which
/// can bury the preview deeper in the file than Nikon or Canon formats.
const SCAN_LIMIT: u64 = 10 * 1024 * 1024;

/// Minimum JPEG size to be worth returning. Rejects EXIF micro-thumbnails
/// (typically 160×120, a few KB) in favour of the larger preview.
const MIN_JPEG_BYTES: usize = 32 * 1024; // 32 KB

pub fn extract_jpeg_preview(path: &str) -> Option<Vec<u8>> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    file.by_ref().take(SCAN_LIMIT).read_to_end(&mut buf).ok()?;

    if buf.len() < 4 {
        return None;
    }

    let mut best_start: usize = 0;
    let mut best_size: usize = 0;
    let mut i: usize = 0;

    while i + 3 <= buf.len() {
        // JPEG SOI: FF D8 FF (the third byte is the first APP/DHT/SOF marker)
        if buf[i] == 0xFF && buf[i + 1] == 0xD8 && buf[i + 2] == 0xFF {
            let jpeg_start = i;

            // Scan forward for EOI (FF D9).
            let mut found = false;
            let mut j = i + 2;
            while j + 1 < buf.len() {
                if buf[j] == 0xFF && buf[j + 1] == 0xD9 {
                    let size = j + 2 - jpeg_start;
                    if size >= MIN_JPEG_BYTES && size > best_size {
                        best_start = jpeg_start;
                        best_size = size;
                    }
                    i = j + 2;
                    found = true;
                    break;
                }
                j += 1;
            }

            if !found {
                let size = buf.len() - jpeg_start;
                if size >= MIN_JPEG_BYTES && size > best_size {
                    best_start = jpeg_start;
                    best_size = size;
                }
                break;
            }
        } else {
            i += 1;
        }
    }

    if best_size < MIN_JPEG_BYTES {
        return None;
    }

    Some(buf[best_start..best_start + best_size].to_vec())
}
