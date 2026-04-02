const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const { Worker } = require('worker_threads');

const workerPath = path.join(__dirname, 'src', 'cleaner', 'worker.js');

function runWorkerTask(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath);
    let settled = false;

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',   // native macOS traffic lights
    backgroundColor: '#0b0d11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,       // never expose Node to renderer directly
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
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

// Real disk usage via diskutil info
// Uses diskutil on two volumes because on APFS (macOS):
//   - / is a sealed read-only system snapshot (~11 GB)
//   - /System/Volumes/Data holds all user data (~200+ GB)
//   - Container Total/Free are the same APFS container, so we only need them once
//   - Summing both Volume Used Space values matches what Disk Utility reports
ipcMain.handle('disk-info', () => {
  try {
    const parseBytes = (str, label) => {
      const m = str.match(new RegExp(`${label}:\\s+[\\d.]+ [TGMK]B \\(([\\d,]+) Bytes\\)`));
      return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
    };

    const sysOut  = execSync('diskutil info /',                    { stdio: 'pipe' }).toString();
    const dataOut = execSync('diskutil info /System/Volumes/Data', { stdio: 'pipe' }).toString();

    const total      = parseBytes(sysOut,  'Container Total Space');
    const available  = parseBytes(dataOut, 'Container Free Space');
    const sysUsed    = parseBytes(sysOut,  'Volume Used Space');
    const dataUsed   = parseBytes(dataOut, 'Volume Used Space');

    if (!total || !available) throw new Error('Could not parse diskutil output');
    const used = (sysUsed || 0) + (dataUsed || 0);

    return { total, used, available };
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
