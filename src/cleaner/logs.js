// logs.js — Log file cleaner (macOS)
//
// Targets:
//   ~/Library/Logs            — user app logs
//   /var/log                  — system logs (user-readable only, skip rest)
//   /Library/Logs             — system-wide app logs
//
// Safety rules:
//   - Only delete .log, .gz, .bz2, .old, .1–.9 rotated log files
//   - Never delete the directory itself
//   - Never delete logs less than 24h old (system may still be writing)
//   - Skip /var/log files we don't have write access to (scan only)

const path = require('path');
const fs   = require('fs');
const { walkDir, totalSize, deleteFiles, dirExists, HOME } = require('./utils');

const LOG_DIRS = [
  `${HOME}/Library/Logs`,
  `${HOME}/Library/Logs/DiagnosticReports`,  // crash reports, hang logs
  '/Library/Logs',
  '/Library/Logs/DiagnosticReports',
  '/var/log',
];

// Only target these extensions
const LOG_EXTENSIONS = new Set(['.log', '.gz', '.bz2', '.old', '.out']);
// Also match rotated logs like syslog.1, syslog.2 …
const ROTATED_LOG_RE = /\.\d+$/;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Check whether a file path looks like a log or rotated log.
function isLogFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (LOG_EXTENSIONS.has(ext)) return true;
  if (ROTATED_LOG_RE.test(filePath)) return true;
  return false;
}

// Guardrail: only delete logs older than one day.
function isOldEnough(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return (Date.now() - stat.mtimeMs) > ONE_DAY_MS;
  } catch {
    return false;
  }
}

// Scan known log directories and return totals + file list.
async function scan() {
  const files = [];

  for (const dir of LOG_DIRS) {
    if (!dirExists(dir)) continue;
    const found = walkDir(dir);
    files.push(
      ...found.filter(f => isLogFile(f) && isOldEnough(f))
    );
  }

  return {
    sizeBytes: totalSize(files),
    fileCount: files.length,
    paths: files,
  };
}

// Clean log files; dryRun returns a preview only.
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

  // For real clean: only delete files we actually have write access to
  const writable = paths.filter(f => {
    try { fs.accessSync(f, fs.constants.W_OK); return true; }
    catch { return false; }
  });

  const { deleted, deletedBytes, failed } = deleteFiles(writable);
  return {
    dryRun: false,
    deleted,
    freedBytes: deletedBytes,
    failed,
  };
}

module.exports = { scan, clean };
