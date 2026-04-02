# CleanOS — Project Context

## Stack
- **Electron 28** (main process = Node.js, renderer = Chromium)
- **No framework** in renderer — vanilla JS + HTML
- **No external runtime deps** (only devDep: electron)

## Architecture
```
main.js          Electron entry. Creates BrowserWindow, registers IPC handlers.
preload.js       Context bridge — exposes window.cleanos API to renderer safely.
src/index.html   UI (renderer). Calls window.cleanos.scan/clean via IPC.
src/cleaner/
  utils.js       Shared fs helpers: walkDir, totalSize, deleteFiles, dirExists
  cache.js       ~/Library/Caches cleaner
  logs.js        ~/Library/Logs + /var/log cleaner
  trash.js       ~/.Trash + external volume trash
  browser.js     Chrome, Firefox, Safari, Brave, Edge cache paths
```

## IPC Channels
| Channel   | Args                          | Returns                          |
|-----------|-------------------------------|----------------------------------|
| scan      | category: string              | { sizeBytes, fileCount, paths }  |
| scan-all  | —                             | { cache, logs, trash, browser }  |
| clean     | categories: string[], opts    | per-category result objects      |

## Safety Model
- **dryRun: true** (default) — scan only, zero filesystem writes
- **dryRun: false** — real deletion, only after explicit user confirmation in UI
- Never follow symlinks
- Never delete directories, only files within them
- Skip files < 24h old in log cleaner
- Trash uses `osascript` (Finder) first, falls back to manual fs delete
- Skip protected macOS dirs (TCC, akd, etc.)

## Current OS: macOS only
Windows and Linux backends to be added later.
Each OS will get its own path resolver and can swap in under the same IPC interface.

## Run
```bash
npm install
npm start
```
