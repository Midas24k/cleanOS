// downloads.js — Large forgotten downloads scanner (macOS)
//
// Targets:
//   ~/Downloads — files larger than MIN_SIZE_BYTES and older than MIN_AGE_DAYS
//
// Safety rules:
//   - Never recurse into subdirectories (only top-level files)
//   - Threshold: > 50 MB AND > 30 days old
//   - Never auto-selects everything — surfaces large/old files for the user to review

const fs   = require('fs');
const path = require('path');
const { totalSize, deleteFiles, HOME } = require('./utils');

const MIN_SIZE_BYTES = 50  * 1024 * 1024; // 50 MB
const MIN_AGE_MS     = 30 * 24 * 60 * 60 * 1000; // 30 days

const DOWNLOADS_DIR = `${HOME}/Downloads`;

// Scan top-level Downloads for large, old files.
function getStaleDownloads() {
  let entries;
  try {
    entries = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const now = Date.now();
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue; // top-level files only
    const full = path.join(DOWNLOADS_DIR, entry.name);
    try {
      const stat = fs.statSync(full);
      if (stat.size >= MIN_SIZE_BYTES && (now - stat.mtimeMs) >= MIN_AGE_MS) {
        files.push({ path: full, sizeBytes: stat.size, mtime: stat.mtimeMs });
      }
    } catch { /* skip unreadable */ }
  }

  // Sort largest first so the UI surfaces the biggest wins at the top
  return files.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

// Return a summary of stale download candidates.
async function scan() {
  const items     = getStaleDownloads();
  const paths     = items.map(i => i.path);
  const sizeBytes = items.reduce((s, i) => s + i.sizeBytes, 0);

  return {
    sizeBytes,
    fileCount: items.length,
    paths,
    items, // includes per-file size + age for UI detail view
  };
}

// Delete stale downloads; dryRun returns a preview only.
async function clean({ dryRun = true } = {}) {
  const { sizeBytes, fileCount, paths, items } = await scan();

  if (dryRun) {
    return {
      dryRun:         true,
      wouldDelete:    fileCount,
      wouldFreeBytes: sizeBytes,
      preview:        paths.slice(0, 20),
      items,
    };
  }

  const { deleted, deletedBytes, failed } = await deleteFiles(paths);
  return {
    dryRun:     false,
    deleted,
    freedBytes: deletedBytes,
    failed,
  };
}

module.exports = { scan, clean };
