// imessage.js — iMessage attachment cleaner (macOS)
//
// Targets: ~/Library/Messages/Attachments
//   Photos, videos, audio and documents shared via iMessage / SMS.
//   If iCloud Messages is enabled, deleted attachments are re-downloaded
//   on demand when you open the conversation. If iCloud Messages is off,
//   deletion is permanent — the UI surfaces this warning.
//
// Safety rules:
//   - Never touches chat.db, chat.db-wal, or chat.db-shm (the message database)
//   - Only deletes files inside the Attachments subdirectory

const path = require('path');
const { walkDir, totalSize, deleteFiles, dirExists, HOME } = require('./utils');

const ATTACHMENTS_DIR = path.join(HOME, 'Library', 'Messages', 'Attachments');

async function scan() {
  if (!dirExists(ATTACHMENTS_DIR)) {
    return { sizeBytes: 0, fileCount: 0, paths: [] };
  }
  const files = walkDir(ATTACHMENTS_DIR);
  return {
    sizeBytes: totalSize(files),
    fileCount: files.length,
    paths:     files,
  };
}

async function clean({ dryRun = true } = {}) {
  const { sizeBytes, fileCount, paths } = await scan();

  if (dryRun) {
    return {
      dryRun:         true,
      wouldDelete:    fileCount,
      wouldFreeBytes: sizeBytes,
      preview:        paths.slice(0, 20),
    };
  }

  const { deleted, deletedBytes, failed } = deleteFiles(paths);
  return { dryRun: false, deleted, freedBytes: deletedBytes, failed };
}

module.exports = { scan, clean };
