// Electron main process entrypoint.
// Owns the native window lifecycle and brokers file-system operations via IPC.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { execSync } = require('child_process');
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

// ── Maintenance ──────────────────────────────────────────────────────────────
const maintenance = require('./src/cleaner/maintenance');

// List all maintenance tasks (metadata only, no execution)
ipcMain.handle('maintenance-list', () => maintenance.list());

// Run a single maintenance task by ID
ipcMain.handle('maintenance-run', (_event, taskId) => maintenance.run(taskId));
