// maintenance.js — System Maintenance Tasks (macOS)
//
// Each task is self-contained: it runs a specific system command and returns
// { ok: true, message } on success or { ok: false, error } on failure.
//
// Tasks that need root use osascript to prompt the user for their password via
// the standard macOS security dialog — no sudo in a shell, no stored credentials.
//
// Safety rules:
//   - Only VACUUMs SQLite databases the current user owns (no system DBs)
//   - DNS flush and font cache tasks use osascript admin prompt — user can cancel
//   - Disk verify is read-only (diskutil verifyVolume)
//   - Launch Services rebuild is non-destructive (macOS rebuilds the DB itself)

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync, spawnSync } = require('child_process');

const HOME = os.homedir();

// ── Helpers ───────────────────────────────────────────────────────────────────

// Run a shell command with macOS admin privileges via osascript.
// Prompts the user for their password through the native dialog.
// Returns { ok, message, error }.
function runAsAdmin(shellCmd) {
  // Escape for embedding inside an AppleScript double-quoted string.
  // These commands are hardcoded so injection is not a concern here,
  // but we escape anyway for correctness.
  const escaped = shellCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const appleScript = `do shell script "${escaped}" with administrator privileges`;
  try {
    execSync(`osascript -e '${appleScript}'`, { stdio: 'pipe', timeout: 30_000 });
    return { ok: true, message: 'Completed successfully' };
  } catch (err) {
    const msg = err.stderr?.toString() || err.message || String(err);
    if (msg.includes('User canceled') || msg.includes('-128')) {
      return { ok: false, error: 'Cancelled — no changes made' };
    }
    return { ok: false, error: msg.trim() };
  }
}

// Run a shell command as the current user.
function runAsUser(shellCmd, timeoutMs = 30_000) {
  try {
    const out = execSync(shellCmd, { stdio: 'pipe', timeout: timeoutMs }).toString().trim();
    return { ok: true, message: out || 'Completed successfully' };
  } catch (err) {
    const msg = err.stderr?.toString() || err.message || String(err);
    return { ok: false, error: msg.trim() };
  }
}

// ── Individual tasks ──────────────────────────────────────────────────────────

function flushDns() {
  // dscacheutil clears the local resolver cache;
  // killall -HUP mDNSResponder restarts the mDNS daemon that macOS uses for
  // local/Bonjour lookups and the unicast DNS proxy.
  return runAsAdmin('dscacheutil -flushcache; killall -HUP mDNSResponder');
}

function rebuildLaunchServices() {
  // lsregister -kill forces a full rebuild of the Launch Services database.
  // This fixes stale "Open With" menus and app-file association issues.
  // Does not require admin — runs as the current user.
  const lsregister =
    '/System/Library/Frameworks/CoreServices.framework' +
    '/Frameworks/LaunchServices.framework/Support/lsregister';
  return runAsUser(
    `${lsregister} -kill -r -domain local -domain system -domain user`,
    60_000,
  );
}

function clearFontCache() {
  // atsutil removes the font registration databases.
  // macOS rebuilds them on next login / app launch.
  // A logout/login is recommended afterwards but not forced here.
  return runAsAdmin('atsutil databases -remove');
}

function purgeMemory() {
  // `purge` asks the kernel to release inactive anonymous memory pages.
  // Useful after memory-intensive work; macOS will reclaim naturally but
  // this forces an immediate sweep.
  return runAsAdmin('purge');
}

function optimizeSqlite() {
  // Find SQLite databases owned by the current user that are safe to VACUUM:
  //   • Browser history / favicons / cookies
  //   • Spotlight metadata store is excluded (system-managed)
  //   • Messages (chat.db) excluded — large & sensitive
  const candidates = [
    // Safari
    `${HOME}/Library/Safari/History.db`,
    `${HOME}/Library/Safari/Bookmarks.db`,
    // Chrome / Chromium
    `${HOME}/Library/Application Support/Google/Chrome/Default/History`,
    `${HOME}/Library/Application Support/Google/Chrome/Default/Favicons`,
    `${HOME}/Library/Application Support/Google/Chrome/Default/Cookies`,
    // Brave
    `${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/Default/History`,
    `${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/Default/Favicons`,
    // Edge
    `${HOME}/Library/Application Support/Microsoft Edge/Default/History`,
    // Firefox (any profile)
    ...globProfiles(
      `${HOME}/Library/Application Support/Firefox/Profiles`,
      ['places.sqlite', 'favicons.sqlite', 'cookies.sqlite'],
    ),
  ].filter(p => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });

  if (candidates.length === 0) {
    return { ok: true, message: 'No eligible databases found' };
  }

  let vacuumed = 0;
  const errors = [];
  for (const db of candidates) {
    try {
      execSync(`sqlite3 "${db}" "VACUUM;"`, { stdio: 'pipe', timeout: 30_000 });
      vacuumed++;
    } catch (err) {
      // DB is locked (browser open) or corrupt — skip gracefully
      errors.push(path.basename(db));
    }
  }

  const skipped = errors.length ? ` — ${errors.length} skipped (locked/in-use)` : '';
  return { ok: true, message: `Optimized ${vacuumed} database${vacuumed !== 1 ? 's' : ''}${skipped}` };
}

// Expand glob-style Firefox profile dirs into specific file paths
function globProfiles(profilesDir, filenames) {
  try {
    return fs.readdirSync(profilesDir).flatMap(profile =>
      filenames.map(f => path.join(profilesDir, profile, f)),
    );
  } catch {
    return [];
  }
}

function verifyDisk() {
  // diskutil verifyVolume is read-only — reports errors without modifying anything.
  try {
    const out = execSync('diskutil verifyVolume /', { stdio: 'pipe', timeout: 120_000 }).toString().trim();
    // If it says "appears to be OK" the disk is healthy
    const healthy = /appears to be OK|verified/i.test(out);
    return {
      ok: true,
      message: healthy
        ? 'Disk appears healthy — no errors found'
        : out.split('\n').slice(-3).join(' '),
    };
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || err.message;
    // Non-zero exit can mean "errors found" (not a crash)
    if (stderr.includes('error') || stderr.includes('Error')) {
      return { ok: false, error: stderr };
    }
    const stdout = err.stdout?.toString().trim() || '';
    return { ok: !!stdout, message: stdout || stderr };
  }
}

// ── Task registry ─────────────────────────────────────────────────────────────

const TASKS = [
  {
    id:            'flush-dns',
    name:          'Flush DNS Cache',
    desc:          'Clears the DNS resolver cache — fixes slow lookups and connectivity glitches',
    icon:          '🌐',
    requiresAdmin: true,
    run:           flushDns,
  },
  {
    id:            'rebuild-launch-services',
    name:          'Rebuild Launch Services',
    desc:          'Rebuilds the app database — fixes broken "Open With" menus and file associations',
    icon:          '🚀',
    requiresAdmin: false,
    run:           rebuildLaunchServices,
  },
  {
    id:            'optimize-sqlite',
    name:          'Optimize Databases',
    desc:          'VACUUMs browser SQLite databases to reclaim fragmented space',
    icon:          '🗄️',
    requiresAdmin: false,
    run:           optimizeSqlite,
  },
  {
    id:            'clear-font-cache',
    name:          'Clear Font Cache',
    desc:          'Removes the system font registry — fixes rendering glitches (log out to finish)',
    icon:          '🔤',
    requiresAdmin: true,
    run:           clearFontCache,
  },
  {
    id:            'purge-memory',
    name:          'Purge Inactive Memory',
    desc:          'Forces the kernel to release inactive memory pages immediately',
    icon:          '🧠',
    requiresAdmin: true,
    run:           purgeMemory,
  },
  {
    id:            'verify-disk',
    name:          'Verify Disk',
    desc:          'Runs a read-only integrity check on the startup volume',
    icon:          '💾',
    requiresAdmin: false,
    run:           verifyDisk,
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

// Returns the static metadata list (safe to send to renderer over IPC)
function list() {
  return TASKS.map(({ id, name, desc, icon, requiresAdmin }) =>
    ({ id, name, desc, icon, requiresAdmin }),
  );
}

// Runs a single task by ID. Returns { ok, message?, error? }.
async function run(taskId) {
  const task = TASKS.find(t => t.id === taskId);
  if (!task) return { ok: false, error: `Unknown task: ${taskId}` };
  try {
    return task.run();
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { list, run };
