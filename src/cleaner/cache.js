// cache.js — System & user cache cleaner (macOS)
//
// Targets:
//   ~/Library/Caches          — per-user app caches (safe to delete)
//   /Library/Caches           — system-wide caches (read-only for most users, skip gracefully)
//
// Safety rules:
//   - Never delete the directory itself, only files inside
//   - Skip com.apple.Safari and com.apple.webkit (handled by browser.js)
//   - Skip anything we can't read

const path = require('path');
const fs   = require('fs');
const { walkDir, totalSize, deleteFiles, dirExists, HOME } = require('./utils');

const CACHE_DIRS = [
  `${HOME}/Library/Caches`,
  '/Library/Caches',
];

// App sandboxed container caches — same content as ~/Library/Caches but
// stored per-container for apps distributed via the Mac App Store
function containerCacheDirs() {
  const containersRoot = `${HOME}/Library/Containers`;
  if (!dirExists(containersRoot)) return [];
  try {
    return fs.readdirSync(containersRoot)
      .map(c => path.join(containersRoot, c, 'Data', 'Library', 'Caches'))
      .filter(dirExists);
  } catch {
    return [];
  }
}

// Subdirectories inside ~/Library/Caches to skip
// (browser caches are handled by browser.js, system internals left alone)
const SKIP_SUBDIRS = new Set([
  'com.apple.Safari',
  'com.apple.WebKit',
  'com.apple.akd',           // authentication daemon — leave alone
  'com.apple.TCC',           // privacy permissions db
]);

function shouldSkip(filePath) {
  const parts = filePath.split(path.sep);
  // If any path segment is in the skip list, ignore this file
  return parts.some(p => SKIP_SUBDIRS.has(p));
}

async function scan() {
  const files = [];
  const allDirs = [...CACHE_DIRS, ...containerCacheDirs()];

  for (const dir of allDirs) {
    if (!dirExists(dir)) continue;
    const found = walkDir(dir);
    files.push(...found.filter(f => !shouldSkip(f)));
  }

  return {
    sizeBytes: totalSize(files),
    fileCount: files.length,
    paths: files,             // full list available for dry-run preview
  };
}

async function clean({ dryRun = true } = {}) {
  const { sizeBytes, fileCount, paths } = await scan();

  if (dryRun) {
    return {
      dryRun: true,
      wouldDelete: fileCount,
      wouldFreeBytes: sizeBytes,
      preview: paths.slice(0, 20), // first 20 for UI preview
    };
  }

  const { deleted, deletedBytes, failed } = deleteFiles(paths);
  return {
    dryRun: false,
    deleted,
    freedBytes: deletedBytes,
    failed,
  };
}

module.exports = { scan, clean };
