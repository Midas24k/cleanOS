// system.js — System Data cleaner (macOS)
//
// Targets two categories that contribute to macOS "System Data":
//
//   1. Time Machine local snapshots (APFS)
//      Deleted via `tmutil deletelocalsnapshots <date>` — macOS recreates
//      them automatically on the next TM backup. On machines with active TM
//      these can be 10–50 GB.
//
//   2. Stale user temp files in /private/var/folders/.../T/
//      macOS stores per-session temp files here. Entries untouched for 3+
//      days are abandoned (the app or process that created them is gone).
//      Only the T/ (temp) subdirectory is touched — C/ (cache) and X/
//      (cross-session, actively used by running apps) are left alone.
//
// Safety rules:
//   - Never delete swap files or the sleep image (/private/var/vm/)
//   - Never touch C/ or X/ in var/folders (active caches, code-sign clones)
//   - Never delete TM snapshots younger than 1 hour (macOS may be mid-backup)
//   - tmutil requires no special entitlements for local snapshots
//   - Temp entries must be at least 3 days old before deletion

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');
const { walkDir, totalSize, deleteFiles, dirExists } = require('./utils');

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS   = 60 * 60 * 1000;

// ── Time Machine snapshots ────────────────────────────────────────────────────

// List Time Machine local snapshots (older than 1 hour is filtered later).
function listSnapshots() {
  try {
    const out = execSync('tmutil listlocalsnapshots /', { stdio: 'pipe' }).toString();
    // Each line looks like: com.apple.TimeMachine.2024-11-15-143022.local
    return out.trim().split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('com.apple.TimeMachine.'))
      .map(name => {
        // Parse date from name: com.apple.TimeMachine.YYYY-MM-DD-HHmmss.local
        const m = name.match(/\.(\d{4}-\d{2}-\d{2}-\d{6})\./);
        const date = m ? parseSnapshotDate(m[1]) : null;
        return { name, date };
      })
      .filter(s => s.date !== null);
  } catch {
    return [];
  }
}

// Parse snapshot date string from tmutil output.
function parseSnapshotDate(str) {
  // str = "2024-11-15-143022"
  const [y, mo, d, hms] = str.split('-');
  const h = hms.slice(0, 2), mi = hms.slice(2, 4), s = hms.slice(4, 6);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
}

// Filter snapshots to those older than ONE_HOUR_MS.
function staleSnapshots() {
  const now = Date.now();
  return listSnapshots().filter(s => (now - s.date.getTime()) > ONE_HOUR_MS);
}

// Estimate snapshot size — tmutil doesn't expose it directly, so we read
// the APFS snapshot list via diskutil and report count only. Size is reported
// as 0 in scan; the UI will show "N snapshots" as the detail.
// Return snapshot count and metadata for stale snapshots.
function scanSnapshots() {
  const snaps = staleSnapshots();
  return { count: snaps.length, snaps };
}

// Delete snapshots by date identifier via tmutil.
function deleteSnapshots(snaps) {
  let deleted = 0;
  const failed = [];
  for (const snap of snaps) {
    try {
      // Date portion only: com.apple.TimeMachine.2024-11-15-143022.local → 2024-11-15-143022
      const m = snap.name.match(/\.(\d{4}-\d{2}-\d{2}-\d{6})\./);
      if (!m) continue;
      execSync(`tmutil deletelocalsnapshots ${m[1]}`, { stdio: 'pipe' });
      deleted++;
    } catch (err) {
      failed.push({ name: snap.name, error: err.message });
    }
  }
  return { deleted, failed };
}

// ── Stale temp files ──────────────────────────────────────────────────────────

// os.tmpdir() returns the active user temp path (/var/folders/.../T)
// Returns top-level entries older than THREE_DAYS_MS.
function staleTempFiles() {
  const tmpDir = os.tmpdir();
  if (!dirExists(tmpDir)) return [];

  const now = Date.now();
  let entries;
  try {
    entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  } catch {
    return [];
  }

  // Collect top-level entries (files + dirs) older than 3 days
  const stale = [];
  for (const entry of entries) {
    const full = path.join(tmpDir, entry.name);
    try {
      const stat = fs.statSync(full);
      if ((now - stat.mtimeMs) >= THREE_DAYS_MS) {
        stale.push(full);
      }
    } catch { /* skip unreadable */ }
  }
  return stale;
}

// Expand stale top-level entries into a flat list of files.
function scanTempFiles(staleEntries) {
  // Walk each stale entry to get all files inside
  const files = [];
  for (const entry of staleEntries) {
    try {
      const stat = fs.statSync(entry);
      if (stat.isDirectory()) {
        files.push(...walkDir(entry));
      } else if (stat.isFile()) {
        files.push(entry);
      }
    } catch { /* skip */ }
  }
  return files;
}

// ── Public API ────────────────────────────────────────────────────────────────

// Scan for stale temp files + TM snapshots and return totals.
async function scan() {
  const { count: snapCount, snaps } = scanSnapshots();
  const staleEntries = staleTempFiles();
  const tempFiles    = scanTempFiles(staleEntries);
  const tempBytes    = totalSize(tempFiles);

  return {
    sizeBytes:  tempBytes,          // snapshot size unknown without sudo; temp size is real
    fileCount:  tempFiles.length,
    paths:      tempFiles,
    snapshots:  { count: snapCount, snaps },
    tempBytes,
    staleEntries,
  };
}

// Clean temp files + stale snapshots; dryRun returns a preview only.
async function clean({ dryRun = true } = {}) {
  const { sizeBytes, fileCount, paths, snapshots, staleEntries } = await scan();

  if (dryRun) {
    return {
      dryRun:         true,
      wouldDelete:    fileCount,
      wouldFreeBytes: sizeBytes,
      snapshots:      { count: snapshots.count },
      preview:        paths.slice(0, 20),
    };
  }

  // Delete temp files
  const { deleted: tempDeleted, deletedBytes: tempDeletedBytes, failed: tempFailed } = deleteFiles(paths);

  // Delete TM snapshots
  const { deleted: snapDeleted, failed: snapFailed } = deleteSnapshots(snapshots.snaps);

  return {
    dryRun:          false,
    deleted:         tempDeleted,
    freedBytes:      tempDeletedBytes,
    failed:          tempFailed,
    snapshots:       { deleted: snapDeleted, failed: snapFailed },
  };
}

module.exports = { scan, clean };
