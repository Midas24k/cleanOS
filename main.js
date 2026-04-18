// Electron main process entrypoint.
// Owns the native window lifecycle and brokers file-system operations via IPC.
const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { execSync, exec } = require('child_process');
const { Worker } = require('worker_threads');

// Worker thread handles heavy scans/cleans off the main thread.
const workerPath = path.join(__dirname, 'src', 'cleaner', 'worker.js');

// Run a single worker task and resolve with its response payload.
// Spawn a worker, send a task, and resolve with the result.
function runWorkerTask(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath);
    let settled = false;

    // Ensure we resolve/reject only once and always terminate the worker.
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      worker.removeAllListeners();
      worker.terminate();
      if (err) reject(err);
      else resolve(result);
    };

    worker.once('message', (msg) => {
      if (msg && msg.ok) finish(null, msg.result);
      else {
        const detail = msg?.error ? `: ${msg.error}` : '';
        finish(new Error(`Worker error${detail}`));
      }
    });
    worker.once('error', (err) => finish(err));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(new Error(`Worker stopped with code ${code}`));
    });

    worker.postMessage(payload);
  });
}

// Create the main application window.
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 580,
    titleBarStyle: 'hiddenInset',   // native macOS traffic lights
    backgroundColor: '#0b0d11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,       // never expose Node to renderer directly
    },
  });

  // Single-page app is served from the local file system.
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// macOS behavior: keep app active until explicit quit.
app.whenReady().then(createWindow);
// Quit on all windows closed (except macOS where apps stay open).
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// Recreate the window on dock click when none are open.
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC handlers ────────────────────────────────────────────────────────────

// Scan a single category → returns { sizeBytes, fileCount, paths[] }
ipcMain.handle('scan', async (_event, category) => {
  return runWorkerTask({ action: 'scan', category });
});

// Scan all categories at once → returns { cache: {...}, logs: {...}, ... }
ipcMain.handle('scan-all', async () => {
  return runWorkerTask({ action: 'scan-all' });
});

// Real disk usage via macOS NSFileManager (JXA bridge).
// Uses NSURLVolumeAvailableCapacityForImportantUsageKey — the same API macOS
// System Storage uses. It includes purgeable space (local TM snapshots, APFS
// cached data) so the "free" number matches what the user sees in Settings.
ipcMain.handle('disk-info', () => {
  try {
    const jxa = [
      'ObjC.import("Foundation");',
      'var url = $.NSURL.fileURLWithPath("/System/Volumes/Data");',
      'var ra = url.resourceValuesForKeysError($.NSArray.arrayWithObject($.NSURLVolumeAvailableCapacityForImportantUsageKey), null);',
      'var rt = url.resourceValuesForKeysError($.NSArray.arrayWithObject($.NSURLVolumeTotalCapacityKey), null);',
      'rt.objectForKey($.NSURLVolumeTotalCapacityKey).description.js + "," +',
      'ra.objectForKey($.NSURLVolumeAvailableCapacityForImportantUsageKey).description.js',
    ].join(' ');

    const out = execSync(`osascript -l JavaScript -e '${jxa}'`, { stdio: 'pipe' }).toString().trim();
    const [totalStr, availStr] = out.split(',');
    const total     = parseInt(totalStr, 10);
    const available = parseInt(availStr, 10);
    if (!total || !available) throw new Error('Could not parse volume capacity');
    const used = total - available;

    // Snap to nearest marketed drive size using base-10 (manufacturers use 1 GB = 1,000,000,000 bytes)
    const MARKETED_GB = [64, 120, 128, 160, 240, 250, 256, 320, 480, 500, 512, 640, 750,
                         1000, 2000, 4000, 8000, 16000, 32000];
    const gb = total / 1e9;
    const snapped = MARKETED_GB.reduce((best, s) =>
      Math.abs(s - gb) < Math.abs(best - gb) ? s : best
    );
    const marketedLabel = snapped >= 1000 ? `${snapped / 1000} TB` : `${snapped} GB`;

    return { total, used, available, marketedLabel };
  } catch (err) {
    return { error: err.message };
  }
});

// iOS-style disk breakdown — runs du on key directories in parallel.
// Each category resolves independently; slow/missing dirs fall back to 0.
ipcMain.handle('disk-breakdown', () => {
  const home = os.homedir();

  const duBytes = (dirs) => new Promise(resolve => {
    const existing = dirs.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
    if (!existing.length) return resolve(0);
    const escaped = existing.map(p => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
    exec(`du -skx ${escaped} 2>/dev/null | awk '{s+=$1}END{print s+0}'`,
      { timeout: 15000 },
      (_, stdout) => resolve((parseInt(stdout.trim() || '0', 10)) * 1024)
    );
  });

  return Promise.all([
    duBytes(['/Applications', path.join(home, 'Applications')]),
    duBytes([path.join(home, 'Pictures')]),
    duBytes([path.join(home, 'Music'), path.join(home, 'Movies')]),
    duBytes([path.join(home, 'Documents'), path.join(home, 'Desktop'), path.join(home, 'Downloads')]),
    duBytes([path.join(home, 'Library', 'Developer')]),
    duBytes([path.join(home, 'Library', 'Mail'), path.join(home, 'Library', 'Mail Downloads')]),
  ]).then(([apps, photos, media, documents, developer, mail]) => ({
    apps, photos, media, documents, developer, mail,
  }));
});

// Clean selected categories
// opts.dryRun = true  → just returns what WOULD be deleted, touches nothing
// opts.dryRun = false → actually deletes
ipcMain.handle('clean', async (_event, categories, opts = { dryRun: true }) => {
  return runWorkerTask({ action: 'clean', categories, opts });
});

// ── Permissions ──────────────────────────────────────────────────────────────

// Probe whether the app has Full Disk Access by attempting to read a path
// that is only accessible with FDA granted. Returns { granted: bool }.
ipcMain.handle('check-permissions', () => {
  // ~/Library/Mail is protected by TCC; readable only with Full Disk Access
  const probe = path.join(os.homedir(), 'Library', 'Mail');
  try {
    if (!fs.existsSync(probe)) return { granted: true };
    fs.readdirSync(probe);
    return { granted: true };
  } catch {
    return { granted: false };
  }
});

// Open System Settings → Privacy & Security → Full Disk Access
ipcMain.handle('open-privacy-settings', () => {
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
  );
});

// ── Kill Process ─────────────────────────────────────────────────────────────
// Send SIGTERM to a user process by PID.
// Protected PIDs (PID 1, this app) are refused unconditionally.
const PROTECTED_PIDS = new Set([1, process.pid]);

ipcMain.handle('kill-process', (_event, pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, error: 'Invalid PID' };
  if (PROTECTED_PIDS.has(pid)) return { ok: false, error: 'Cannot kill a protected system process' };
  try {
    process.kill(pid, 'SIGTERM');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── RAM Info ─────────────────────────────────────────────────────────────────
// Returns RAM stats from vm_stat + sysctl, plus top processes from ps.
ipcMain.handle('ram-info', () => {
  try {
    const totalBytes = parseInt(
      execSync('sysctl -n hw.memsize', { stdio: 'pipe' }).toString().trim(), 10
    );
    const pageSize = parseInt(
      execSync('sysctl -n hw.pagesize', { stdio: 'pipe' }).toString().trim(), 10
    );

    const vmstat = execSync('vm_stat', { stdio: 'pipe' }).toString();
    function parseStat(name) {
      const m = vmstat.match(new RegExp(name + ':\\s+(\\d+)'));
      return m ? parseInt(m[1], 10) * pageSize : 0;
    }
    function parseStatRaw(name) {
      const m = vmstat.match(new RegExp(name + ':\\s+(\\d+)'));
      return m ? parseInt(m[1], 10) : 0;
    }

    const free        = parseStat('Pages free');
    const active      = parseStat('Pages active');
    const inactive    = parseStat('Pages inactive');
    const speculative = parseStat('Pages speculative');
    const wired       = parseStat('Pages wired down');
    const compressed  = parseStat('Pages occupied by compressor');
    const fileBacked  = parseStat('File-backed pages');

    // "Used" mirrors Activity Monitor: App Memory (active anon) + Wired + Compressed.
    // We approximate: used = total - free - speculative - file-backed - inactive
    const available = free + speculative + fileBacked + inactive;
    const used = Math.max(0, totalBytes - available);

    // Pressure: derived from available ratio
    const availRatio = available / totalBytes;
    const pressure = availRatio < 0.05 ? 'critical' : availRatio < 0.15 ? 'warning' : 'normal';

    // Top 10 processes by RSS
    const psOut = execSync(
      "ps -axo pid=,rss=,comm= 2>/dev/null | sort -k2 -rn | head -10",
      { stdio: 'pipe', timeout: 8000 }
    ).toString().trim();

    const topProcesses = psOut.split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      const pid     = parseInt(parts[0], 10);
      const rssKB   = parseInt(parts[1], 10);
      const name    = parts.slice(2).join(' ');
      return { pid, name, rssBytes: rssKB * 1024 };
    }).filter(p => !isNaN(p.rssBytes) && p.rssBytes > 0);

    // Swap usage from sysctl vm.swapusage
    // Output: "vm.swapusage: total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)"
    let swap = { total: 0, used: 0, free: 0, encrypted: false };
    try {
      const swapOut = execSync('sysctl vm.swapusage', { stdio: 'pipe' }).toString();
      const m = swapOut.match(/total\s*=\s*([\d.]+)([MG])\s+used\s*=\s*([\d.]+)([MG])\s+free\s*=\s*([\d.]+)([MG])/);
      if (m) {
        const toBytes = (val, unit) => Math.round(parseFloat(val) * (unit === 'G' ? 1e9 : 1e6));
        swap.total     = toBytes(m[1], m[2]);
        swap.used      = toBytes(m[3], m[4]);
        swap.free      = toBytes(m[5], m[6]);
        swap.encrypted = /encrypted/i.test(swapOut);
      }
    } catch { /* swap unavailable or not active */ }

    // Page fault activity (cumulative since boot) — indicates swap pressure over time
    const swapins  = parseStatRaw('Swapins');
    const swapouts = parseStatRaw('Swapouts');

    return {
      total: totalBytes,
      used,
      free: available,
      pressure,
      breakdown: { wired, active, compressed, inactive, fileBacked, free },
      swap: { ...swap, swapins, swapouts },
      topProcesses,
    };
  } catch (err) {
    return { error: err.message };
  }
});

// ── Auto-Scan Schedule ────────────────────────────────────────────────────────

const SCHEDULE_PATH = path.join(app.getPath('userData'), 'schedule.json');

const DEFAULT_SCHEDULE = { enabled: false, intervalHours: 24, lastRunAt: null, lastResult: null };

function loadSchedule() {
  try { return { ...DEFAULT_SCHEDULE, ...JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_SCHEDULE }; }
}

function saveSchedule(cfg) {
  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(cfg, null, 2));
}

let scheduleTimer = null;

function startScheduleTimer(cfg) {
  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null; }
  if (!cfg.enabled || !cfg.intervalHours) return;

  const intervalMs = cfg.intervalHours * 60 * 60 * 1000;

  // Check every minute if it's time to run.
  scheduleTimer = setInterval(async () => {
    const current = loadSchedule();
    if (!current.enabled) { clearInterval(scheduleTimer); scheduleTimer = null; return; }
    const now = Date.now();
    const last = current.lastRunAt || 0;
    if (now - last < intervalMs) return;

    try {
      const result = await runWorkerTask({ action: 'scan-all' });
      current.lastRunAt = now;
      current.lastResult = result;
      saveSchedule(current);

      // Notify the renderer so the UI can refresh.
      BrowserWindow.getAllWindows().forEach(w =>
        w.webContents.send('schedule-scan-complete', { lastRunAt: now, lastResult: result })
      );

      if (Notification.isSupported()) {
        const categories = Object.keys(result);
        const totalBytes = categories.reduce((s, k) => s + (result[k]?.sizeBytes || 0), 0);
        const mb = (totalBytes / 1024 / 1024).toFixed(1);
        new Notification({
          title: 'CleanOS Auto-Scan Complete',
          body: `Found ${mb} MB of junk across ${categories.length} categories.`,
        }).show();
      }
    } catch { /* scan failed silently */ }
  }, 60_000);
}

app.whenReady().then(() => {
  const cfg = loadSchedule();
  startScheduleTimer(cfg);
});

ipcMain.handle('schedule-get', () => loadSchedule());

ipcMain.handle('schedule-set', (_event, cfg) => {
  const merged = { ...loadSchedule(), ...cfg };
  saveSchedule(merged);
  startScheduleTimer(merged);
  return merged;
});

// ── Maintenance ──────────────────────────────────────────────────────────────
const maintenance = require('./src/cleaner/maintenance');

// List all maintenance tasks (metadata only, no execution)
ipcMain.handle('maintenance-list', () => maintenance.list());

// Run a single maintenance task by ID
ipcMain.handle('maintenance-run', (_event, taskId) => maintenance.run(taskId));
