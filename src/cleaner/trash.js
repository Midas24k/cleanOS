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
const { execSync } = require('child_process');
const { walkDir, totalSize, deleteFiles, dirExists, HOME } = require('./utils');

const UID = process.getuid ? process.getuid() : null;

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

async function scan() {
  const files = [];
  for (const dir of getTrashDirs()) {
    if (!dirExists(dir)) continue;
    files.push(...walkDir(dir));
  }

  return {
    sizeBytes: totalSize(files),
    fileCount: files.length,
    paths: files,
  };
}

async function clean({ dryRun = true } = {}) {
  const { sizeBytes, fileCount, paths } = await scan();

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
    return { dryRun: false, deleted: fileCount, freedBytes: sizeBytes, failed: [], method: 'osascript' };
  } catch {
    // Fallback: manual deletion
    const { deleted, failed } = deleteFiles(paths);
    return { dryRun: false, deleted, freedBytes: sizeBytes, failed, method: 'manual' };
  }
}

module.exports = { scan, clean };
