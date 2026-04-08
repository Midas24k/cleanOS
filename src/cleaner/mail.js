// mail.js — Mail attachment cache cleaner (macOS)
//
// Targets:
//   ~/Library/Mail/V*/*/**.mbox/Attachments/  — per-mailbox attachment caches
//   ~/Library/Mail Downloads/                 — legacy manual downloads folder
//
// Safety rules:
//   - Only files inside Attachments/ subdirs — never .emlx message files
//   - Never deletes the .mbox directory itself
//   - Skips files newer than 24 h (may still be in use)
//   - Skips anything unreadable (permissions)

const fs   = require('fs');
const path = require('path');
const { walkDir, totalSize, deleteFiles, dirExists, HOME } = require('./utils');

const MAIL_ROOT     = path.join(HOME, 'Library', 'Mail');
const MAIL_DL_DIR   = path.join(HOME, 'Library', 'Mail Downloads');
const ONE_DAY_MS    = 24 * 60 * 60 * 1000;

// Walk ~/Library/Mail/V*/*/ and collect all Attachments/ dirs inside .mbox packages
function attachmentDirs() {
  const dirs = [];
  if (!dirExists(MAIL_ROOT)) return dirs;

  let versions;
  try {
    versions = fs.readdirSync(MAIL_ROOT, { withFileTypes: true });
  } catch {
    return dirs;
  }

  for (const v of versions) {
    if (!v.isDirectory() || !v.name.startsWith('V')) continue;
    const vPath = path.join(MAIL_ROOT, v.name);

    let accounts;
    try { accounts = fs.readdirSync(vPath, { withFileTypes: true }); }
    catch { continue; }

    for (const acct of accounts) {
      if (!acct.isDirectory()) continue;
      const acctPath = path.join(vPath, acct.name);
      collectMboxAttachmentDirs(acctPath, dirs);
    }
  }

  return dirs;
}

// Recurse into an account dir, finding .mbox/Attachments/ paths
function collectMboxAttachmentDirs(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);

    if (e.name.endsWith('.mbox')) {
      const attDir = path.join(full, 'Attachments');
      if (dirExists(attDir)) out.push(attDir);
      // Recurse — nested mailboxes (folders inside folders)
      collectMboxAttachmentDirs(full, out);
    } else {
      // Plain sub-folder (e.g. account-level grouping dirs)
      collectMboxAttachmentDirs(full, out);
    }
  }
}

function isOldEnough(filePath) {
  try {
    return (Date.now() - fs.statSync(filePath).mtimeMs) > ONE_DAY_MS;
  } catch {
    return false;
  }
}

async function scan() {
  const files = [];

  for (const dir of attachmentDirs()) {
    const found = walkDir(dir);
    files.push(...found.filter(isOldEnough));
  }

  if (dirExists(MAIL_DL_DIR)) {
    const found = walkDir(MAIL_DL_DIR);
    files.push(...found.filter(isOldEnough));
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

  const writable = paths.filter(f => {
    try { fs.accessSync(f, fs.constants.W_OK); return true; }
    catch { return false; }
  });

  const { deleted, failed } = deleteFiles(writable);
  return {
    dryRun: false,
    deleted,
    freedBytes: sizeBytes,
    failed,
  };
}

module.exports = { scan, clean };
