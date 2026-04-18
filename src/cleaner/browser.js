// browser.js — Browser cache & data cleaner (macOS)
//
// Targets per browser:
//   Chrome   — ~/Library/Application Support/Google/Chrome/Default/Cache
//              ~/Library/Application Support/Google/Chrome/Default/Code Cache
//   Firefox  — ~/Library/Application Support/Firefox/Profiles/<profile>/cache2
//   Safari   — ~/Library/Caches/com.apple.Safari
//              ~/Library/Safari/LocalStorage  (kept — user data)
//   Brave    — ~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Cache
//   Edge     — ~/Library/Application Support/Microsoft Edge/Default/Cache
//
// Safety rules:
//   - ONLY delete Cache directories, never profile data, history, passwords, bookmarks
//   - Never touch LocalStorage, IndexedDB, or Cookies

const path = require('path');
const { walkDir, totalSize, deleteFiles, dirExists, HOME } = require('./utils');

// Each entry: { name, cacheDirs[] }
const BROWSERS = [
  {
    name: 'Chrome',
    cacheDirs: [
      ...chromiumProfileCacheDirs('Google/Chrome'),
      `${HOME}/Library/Application Support/Google/Chrome/Default/GPUCache`,
    ],
  },
  {
    name: 'Firefox',
    cacheDirs: firefoxCacheDirs(),
  },
  {
    name: 'Safari',
    cacheDirs: [
      `${HOME}/Library/Caches/com.apple.Safari`,
      `${HOME}/Library/Caches/com.apple.WebKit`,
    ],
  },
  {
    name: 'Brave',
    cacheDirs: chromiumProfileCacheDirs('BraveSoftware/Brave-Browser'),
  },
  {
    name: 'Edge',
    cacheDirs: chromiumProfileCacheDirs('Microsoft Edge'),
  },
  {
    name: 'Arc',
    cacheDirs: chromiumProfileCacheDirs('Arc/User Data'),
  },
  {
    name: 'Opera',
    cacheDirs: chromiumProfileCacheDirs('com.operasoftware.Opera'),
  },
  {
    name: 'Vivaldi',
    cacheDirs: chromiumProfileCacheDirs('Vivaldi'),
  },
];

// Chromium-based browsers store caches under Default/ and any numbered Profile N/
// This picks up all profiles rather than only Default.
// Returns a list of cache directories for an app if they exist.
function chromiumProfileCacheDirs(appDir) {
  const base = `${HOME}/Library/Application Support/${appDir}`;
  if (!dirExists(base)) return [];
  const fs = require('fs');
  const dirs = [];
  try {
    const profiles = fs.readdirSync(base).filter(d => d === 'Default' || /^Profile \d+$/.test(d));
    for (const p of profiles) {
      dirs.push(
        `${base}/${p}/Cache`,
        `${base}/${p}/Code Cache`,
        `${base}/${p}/GPUCache`,
      );
    }
  } catch { /* no access */ }
  return dirs.filter(dirExists);
}

// Return Firefox profile cache directories (cache2).
function firefoxCacheDirs() {
  const profilesRoot = `${HOME}/Library/Application Support/Firefox/Profiles`;
  if (!dirExists(profilesRoot)) return [];
  try {
    const fs = require('fs');
    return fs.readdirSync(profilesRoot)
      .map(p => path.join(profilesRoot, p, 'cache2'))
      .filter(dirExists);
  } catch {
    return [];
  }
}

// Scan all browser caches and return totals + per-browser breakdown.
async function scan() {
  const allFiles = [];
  const byBrowser = {};

  for (const browser of BROWSERS) {
    const files = [];
    for (const dir of browser.cacheDirs) {
      if (!dirExists(dir)) continue;
      files.push(...walkDir(dir));
    }
    const sizeBytes = totalSize(files);
    byBrowser[browser.name] = { sizeBytes, fileCount: files.length };
    allFiles.push(...files);
  }

  return {
    sizeBytes: totalSize(allFiles),
    fileCount: allFiles.length,
    paths: allFiles,
    byBrowser,   // breakdown per browser available for UI
  };
}

// Clean browser caches; dryRun returns a preview only.
async function clean({ dryRun = true } = {}) {
  const { sizeBytes, fileCount, paths, byBrowser } = await scan();

  if (dryRun) {
    return {
      dryRun: true,
      wouldDelete: fileCount,
      wouldFreeBytes: sizeBytes,
      byBrowser,
      preview: paths.slice(0, 20),
    };
  }

  const { deleted, deletedBytes, failed } = await deleteFiles(paths);
  return {
    dryRun: false,
    deleted,
    freedBytes: deletedBytes,
    byBrowser,
    failed,
  };
}

module.exports = { scan, clean };
