const fs   = require('fs');
const path = require('path');
const os   = require('os');

const HOME = os.homedir();

// Resolve ~ in paths
function resolvePath(p) {
  return p.startsWith('~') ? path.join(HOME, p.slice(1)) : p;
}

// Walk a directory recursively, collecting all file paths.
// Skips paths we can't read (permissions) silently.
function walkDir(dir, collected = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return collected; // permission denied or doesn't exist — skip
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // never follow symlinks
    if (entry.isDirectory()) {
      walkDir(full, collected);
    } else if (entry.isFile()) {
      collected.push(full);
    }
  }
  return collected;
}

// Get total size of a list of file paths (bytes)
function totalSize(files) {
  let bytes = 0;
  for (const f of files) {
    try {
      bytes += fs.statSync(f).size;
    } catch { /* skip */ }
  }
  return bytes;
}

// Delete a list of files. Returns { deleted, failed[] }
function deleteFiles(files) {
  let deleted = 0;
  const failed = [];
  for (const f of files) {
    try {
      fs.unlinkSync(f);
      deleted++;
    } catch (err) {
      failed.push({ path: f, error: err.message });
    }
  }
  return { deleted, failed };
}

// Check if a directory exists and is accessible
function dirExists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = { resolvePath, walkDir, totalSize, deleteFiles, dirExists, HOME };
