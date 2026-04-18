const fs   = require('fs');
const path = require('path');
const os   = require('os');

const HOME = os.homedir();

// Resolve ~ in paths
function resolvePath(p) {
  return p.startsWith('~') ? path.join(HOME, p.slice(1)) : p;
}

// Walk a directory recursively, collecting file paths.
// Stops once `maxFiles` is reached to prevent memory blowup on huge directories.
// Skips symlinks and unreadable paths silently.
function walkDir(dir, { maxFiles = 50_000 } = {}) {
  const collected = [];
  _walk(dir, collected, maxFiles);
  return collected;
}

function _walk(dir, collected, maxFiles) {
  if (collected.length >= maxFiles) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // permission denied or doesn't exist — skip
  }
  for (const entry of entries) {
    if (collected.length >= maxFiles) break;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // never follow symlinks
    if (entry.isDirectory()) {
      _walk(full, collected, maxFiles);
    } else if (entry.isFile()) {
      collected.push(full);
    }
  }
}

// Get total size of a list of file paths (bytes).
// Ignores files that can't be stat'd.
function totalSize(files) {
  let bytes = 0;
  for (const f of files) {
    try { bytes += fs.statSync(f).size; } catch { /* skip */ }
  }
  return bytes;
}

// Delete a list of files with bounded concurrency.
// Returns { deleted, deletedBytes, failed[] }.
// Attempts every file; never throws on individual failures.
async function deleteFiles(files, { concurrency = 8 } = {}) {
  if (!files.length) return { deleted: 0, deletedBytes: 0, failed: [] };

  // Collect sizes synchronously upfront (one pass, avoids a second stat inside the loop).
  const items = files.map(f => {
    let size = 0;
    try { size = fs.statSync(f).size; } catch { /* size unknown */ }
    return { f, size };
  });

  let deleted      = 0;
  let deletedBytes = 0;
  const failed     = [];
  let i            = 0;

  // Each worker grabs the next item until the list is exhausted.
  // JS single-threaded event loop makes `i++` safe between awaits.
  async function worker() {
    while (i < items.length) {
      const { f, size } = items[i++];
      try {
        await fs.promises.unlink(f);
        deleted++;
        deletedBytes += size;
      } catch (err) {
        failed.push({ path: f, error: err.message });
      }
    }
  }

  const poolSize = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: poolSize }, worker));

  return { deleted, deletedBytes, failed };
}

// Check if a directory exists and is readable.
function dirExists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = { resolvePath, walkDir, totalSize, deleteFiles, dirExists, HOME };
