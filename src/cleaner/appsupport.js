// appsupport.js — Application Support cleaner (macOS)
//
// Two scan targets inside ~/Library/Application Support:
//   1. Orphaned bundle-ID folders — com.company.app dirs whose app is no longer
//      installed in /Applications or ~/Applications.
//   2. Known cache subdirs — Cache, CachedData, Code Cache, GPUCache, etc.
//      one or two levels deep inside any app support folder.
//
// Safety rules:
//   - Orphan detection only runs on bundle-ID-format names (com.xxx.yyy).
//     Name-based folders (Google, Notion, Steam…) are never auto-flagged.
//   - Never deletes directories — only the files inside them.
//   - Skips anything we can't read.

const path = require('path');
const fs   = require('fs');
const { walkDir, totalSize, deleteFiles, dirExists, HOME } = require('./utils');

const APP_SUPPORT = path.join(HOME, 'Library', 'Application Support');
const APP_DIRS    = ['/Applications', path.join(HOME, 'Applications')];

// Known cache subdir names that are safe to clean inside any app support folder
const CACHE_SUBDIR_NAMES = new Set([
  'Cache', 'Caches', 'CachedData', 'Code Cache', 'GPUCache',
  'ShaderCache', 'DiskCache', 'CacheStorage', 'blob_storage',
  'Service Worker', 'VideoDecodeStats', 'NetworkPersistentState',
]);

// Matches bundle ID format: com.company.appname (two or more dot-separated segments)
const BUNDLE_ID_RE = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*){2,}$/;

// Read CFBundleIdentifier from an app bundle's XML Info.plist.
function readBundleId(appPath) {
  try {
    const plist = path.join(appPath, 'Contents', 'Info.plist');
    const content = fs.readFileSync(plist, 'utf8');
    const m = content.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// Build the set of installed bundle IDs from /Applications + ~/Applications.
function installedBundleIds() {
  const ids = new Set();
  for (const dir of APP_DIRS) {
    if (!dirExists(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.app')) continue;
        const bid = readBundleId(path.join(dir, entry));
        if (bid) ids.add(bid);
      }
    } catch { /* skip unreadable dir */ }
  }
  return ids;
}

// Return Application Support dirs whose bundle-ID-format name has no matching
// installed app.
function findOrphanedFolders(installedIds) {
  if (!dirExists(APP_SUPPORT)) return [];
  const orphans = [];
  try {
    for (const entry of fs.readdirSync(APP_SUPPORT)) {
      if (!BUNDLE_ID_RE.test(entry)) continue;
      if (installedIds.has(entry.toLowerCase())) continue;
      const full = path.join(APP_SUPPORT, entry);
      try {
        if (fs.statSync(full).isDirectory()) orphans.push(full);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return orphans;
}

// Collect known cache subdirs up to 2 levels deep inside Application Support.
function findCacheSubdirs() {
  if (!dirExists(APP_SUPPORT)) return [];
  const found = [];
  let level1Entries;
  try { level1Entries = fs.readdirSync(APP_SUPPORT); } catch { return []; }

  for (const appFolder of level1Entries) {
    const appPath = path.join(APP_SUPPORT, appFolder);
    try { if (!fs.statSync(appPath).isDirectory()) continue; } catch { continue; }

    let level2Entries;
    try { level2Entries = fs.readdirSync(appPath); } catch { continue; }

    for (const sub of level2Entries) {
      const subPath = path.join(appPath, sub);
      if (CACHE_SUBDIR_NAMES.has(sub)) {
        try { if (fs.statSync(subPath).isDirectory()) found.push(subPath); } catch { /* skip */ }
        continue;
      }
      // One level deeper (e.g. Google/Chrome/Default/Cache)
      try {
        if (!fs.statSync(subPath).isDirectory()) continue;
        for (const deep of fs.readdirSync(subPath)) {
          if (!CACHE_SUBDIR_NAMES.has(deep)) continue;
          const deepPath = path.join(subPath, deep);
          try { if (fs.statSync(deepPath).isDirectory()) found.push(deepPath); } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }
  return found;
}

async function scan() {
  const installedIds = installedBundleIds();
  const orphanDirs   = findOrphanedFolders(installedIds);
  const cacheDirs    = findCacheSubdirs();

  // Deduplicate: if a cache dir is inside an orphaned folder, the orphan walk
  // already covers it — no need to double-count.
  const orphanSet  = new Set(orphanDirs);
  const uniqueCache = cacheDirs.filter(c => !orphanDirs.some(o => c.startsWith(o + path.sep)));

  const allFiles = [];
  for (const dir of [...orphanDirs, ...uniqueCache]) {
    allFiles.push(...walkDir(dir));
  }

  return {
    sizeBytes:   totalSize(allFiles),
    fileCount:   allFiles.length,
    paths:       allFiles,
    orphanCount: orphanDirs.length,
    cacheCount:  uniqueCache.length,
  };
}

async function clean({ dryRun = true } = {}) {
  const { sizeBytes, fileCount, paths, orphanCount, cacheCount } = await scan();

  if (dryRun) {
    return {
      dryRun:         true,
      wouldDelete:    fileCount,
      wouldFreeBytes: sizeBytes,
      preview:        paths.slice(0, 20),
      orphanCount,
      cacheCount,
    };
  }

  const { deleted, deletedBytes, failed } = await deleteFiles(paths);
  return {
    dryRun:     false,
    deleted,
    freedBytes: deletedBytes,
    failed,
  };
}

module.exports = { scan, clean };
