const { contextBridge, ipcRenderer } = require('electron');

// Expose a clean, typed API to the renderer.
// The renderer never touches ipcRenderer or Node directly.
contextBridge.exposeInMainWorld('cleanos', {

  // Scan one category: 'cache' | 'logs' | 'trash' | 'browser'
  scan: (category) => ipcRenderer.invoke('scan', category),

  // Scan all categories at once
  scanAll: () => ipcRenderer.invoke('scan-all'),

  // Clean selected categories
  // dryRun: true  → preview only, nothing deleted
  // dryRun: false → real delete
  clean: (categories, dryRun = true) =>
    ipcRenderer.invoke('clean', categories, { dryRun }),

  // Real disk usage from df
  diskInfo: () => ipcRenderer.invoke('disk-info'),
});
