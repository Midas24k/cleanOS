// trash.js — Trash cleaner (macOS)
//
// Targets:
//   ~/.Trash                  — main user trash
//   /Volumes/*/  .Trashes/<uid>  — trash on mounted external drives
//
// Uses macOS `osascript` to empty trash the "proper" way first.
// Falls back to manual fs deletion if osascript is unavailable.
//
// Safety rules:
//   - Only touch ~/.Trash and volume-specific .Trashes/<uid> dirs
//   - Never delete the .Trash directory itself, only its contents

const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');
const { walkDir, totalSize, deleteFiles, dirExists, HOME } = require('./utils');

const UID = process.getuid ? process.getuid() : null;

// Build a list of trash directories for the current user.
function getTrashDirs() {
  const dirs = [`${HOME}/.Trash`];

  // Add external volume trash dirs if accessible
  try {
    const volumes = fs.readdirSync('/Volumes');
    for (const vol of volumes) {
      const trashDir = UID
        ? `/Volumes/${vol}/.Trashes/${UID}`
        : `/Volumes/${vol}/.Trashes`;
      if (dirExists(trashDir)) dirs.push(trashDir);
    }
  } catch { /* /Volumes not accessible */ }

  return dirs;
}

// Scan trash bins and return totals + top-level item list.
async function scan() {
  const allFiles = [];      // all files recursively — for size + fallback delete
  const topLevelItems = []; // what the user actually put in trash (for display)

  for (const dir of getTrashDirs()) {
    if (!dirExists(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // skip macOS metadata (.DS_Store etc.)
        topLevelItems.push(path.join(dir, entry.name));
      }
    } catch { /* permission denied — skip */ }
    allFiles.push(...walkDir(dir));
  }

  return {
    sizeBytes: totalSize(allFiles),
    fileCount: topLevelItems.length, // items user put in trash, matching Finder's count
    paths: topLevelItems,            // top-level items shown in preview
    allFiles,                        // internal: used by clean() fallback
  };
}

// Empty trash bins; dryRun returns a preview only.
async function clean({ dryRun = true } = {}) {
  const { sizeBytes, fileCount, paths, allFiles } = await scan();

  if (dryRun) {
    return {
      dryRun: true,
      wouldDelete: fileCount,
      wouldFreeBytes: sizeBytes,
      preview: paths.slice(0, 20),
    };
  }

  // Preferred: use AppleScript so macOS handles it natively
  try {
    execSync(`osascript -e 'tell application "Finder" to empty trash'`, {
      timeout: 30000,
      stdio: 'pipe',  // suppress osascript stderr — fallback handles the failure
    });
    const after = await scan();
    const freedBytes = Math.max(0, sizeBytes - after.sizeBytes);
    const deleted = Math.max(0, fileCount - after.fileCount);
    return { dryRun: false, deleted, freedBytes, failed: [], method: 'osascript' };
  } catch {
    // Fallback: manual deletion — uses all individual files (dirs can't be unlinked)
    const { deleted, deletedBytes, failed } = deleteFiles(allFiles);
    return { dryRun: false, deleted, freedBytes: deletedBytes, failed, method: 'manual' };
  }
}

module.exports = { scan, clean };
