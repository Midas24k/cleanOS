// Preload runs in an isolated context. It exposes a safe API to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

// Expose a clean, typed API to the renderer.
// The renderer never touches ipcRenderer or Node directly.
contextBridge.exposeInMainWorld('cleanos', {

  // Scan one category: 'cache' | 'logs' | 'trash' | 'browser' | ...
  scan: (category) => ipcRenderer.invoke('scan', category),

  // Scan all categories at once
  scanAll: () => ipcRenderer.invoke('scan-all'),

  // Clean selected categories
  // dryRun: true  → preview only, nothing deleted
  // dryRun: false → real delete
  clean: (categories, dryRun = true) =>
    ipcRenderer.invoke('clean', categories, { dryRun }),

  // Real disk usage from diskutil (macOS)
  diskInfo: () => ipcRenderer.invoke('disk-info'),

  // iOS-style storage breakdown by category
  diskBreakdown: () => ipcRenderer.invoke('disk-breakdown'),

  // Maintenance tasks
  maintenanceList: () => ipcRenderer.invoke('maintenance-list'),
  maintenanceRun:  (taskId) => ipcRenderer.invoke('maintenance-run', taskId),

  // RAM stats + top processes
  ramInfo: () => ipcRenderer.invoke('ram-info'),

  // Kill a process by PID (sends SIGTERM)
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),

  // macOS Full Disk Access
  checkPermissions:    () => ipcRenderer.invoke('check-permissions'),
  openPrivacySettings: () => ipcRenderer.invoke('open-privacy-settings'),
});
