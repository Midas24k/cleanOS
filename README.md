# cleanOS

macOS-first desktop system cleaner built with Electron and a vanilla HTML/CSS/JS renderer.

cleanOS scans reclaimable disk usage across common junk-file categories, previews deletions by default, and only performs real cleanup when explicitly requested.

## Highlights

- Worker-thread scanning and cleaning so the UI stays responsive.
- Dry-run mode enabled by default (safe preview, no writes).
- Category-based cleaning across caches, logs, trash, browser data, developer artifacts, and more.
- Disk usage card with real volume data and category breakdown.
- Full Disk Access probe with direct deep-link to macOS Privacy settings.
- Built-in maintenance tasks (DNS flush, Launch Services rebuild, SQLite optimize, disk verify, etc.).

## Tech Stack

- Electron 28
- Renderer: vanilla HTML/CSS/JavaScript (no frontend framework)
- Test stack: Jest (unit), Playwright (UI smoke)

## Project Layout

```text
.
├── main.js                     # Electron main process + IPC handlers
├── preload.js                  # contextBridge API exposed as window.cleanos
├── src/
│   ├── index.html              # Complete renderer UI + client logic
│   └── cleaner/
│       ├── worker.js           # Off-main-thread scan/clean dispatcher
│       ├── utils.js            # Shared fs traversal/size/delete helpers
│       ├── cache.js            # System/user cache cleaning
│       ├── logs.js             # Log/rotated log cleaning
│       ├── trash.js            # User + external volume trash handling
│       ├── browser.js          # Browser cache cleaning
│       ├── developer.js        # Xcode/package manager/dev caches
│       ├── downloads.js        # Stale large downloads
│       ├── system.js           # Temp files + Time Machine snapshots
│       ├── mail.js             # Mail attachment caches
│       ├── appsupport.js       # Orphaned app support + nested cache dirs
│       ├── simulator.js        # Unavailable iOS simulator cleanup
│       ├── imessage.js         # Messages attachment cleanup
│       └── maintenance.js      # One-shot maintenance tasks
├── tests/
│   ├── unit/                   # Jest tests for cleaner modules
│   └── e2e/                    # Playwright UI smoke tests
├── jest.config.js
└── playwright.config.js
```

## Install and Run

```bash
npm install
npm start
```

Useful scripts:

```bash
npm run dev            # electron . --dev
npm test               # unit tests
npm run test:unit      # unit tests
npm run test:e2e       # playwright tests
npm run test:coverage  # jest coverage
```

## Safety Model

- `dryRun: true` is the default in both UI and API.
- No symlink traversal during directory walking.
- Cleaners delete files, not directories.
- Many cleaners use age and/or extension filters to avoid hot files.
- Permission failures are handled gracefully per file/path.

Notable guardrails by module:

- `logs`: only log-like files and only older than 24h.
- `mail`: attachment cache targets only; skips files newer than 24h.
- `downloads`: top-level `~/Downloads` files only, must be >50 MB and >30 days old.
- `system`: only stale temp entries (3+ days) and stale Time Machine local snapshots (older than 1h).
- `browser`: cache directories only, avoids cookies/history/profile data.
- `trash`: only `~/.Trash` and mounted volume `.Trashes/<uid>`.

## Cleanup Categories

`worker.js` currently registers these categories:

- `cache`
- `logs`
- `trash`
- `browser`
- `developer`
- `downloads`
- `system`
- `mail`
- `appsupport`
- `simulator`
- `imessage`

Each category implements:

- `scan() -> { sizeBytes, fileCount, paths, ... }`
- `clean({ dryRun }) -> dry-run preview OR real deletion result`

## IPC API (Main Process)

Registered in `main.js`:

- `scan(category)`
- `scan-all()`
- `clean(categories, { dryRun })`
- `disk-info()`
- `disk-breakdown()`
- `check-permissions()`
- `open-privacy-settings()`
- `maintenance-list()`
- `maintenance-run(taskId)`

Renderer access is intentionally mediated via `preload.js` and exposed as `window.cleanos`.

## Renderer API

`window.cleanos` methods:

- `scan(category)`
- `scanAll()`
- `clean(categories, dryRun = true)`
- `diskInfo()`
- `diskBreakdown()`
- `maintenanceList()`
- `maintenanceRun(taskId)`
- `checkPermissions()`
- `openPrivacySettings()`

## Maintenance Tasks

Available task IDs from `maintenance.js`:

- `flush-dns`
- `rebuild-launch-services`
- `optimize-sqlite`
- `clear-font-cache`
- `purge-memory`
- `verify-disk`

Some tasks require admin privileges and use the native macOS password prompt via AppleScript (`do shell script ... with administrator privileges`).

## Permissions

cleanOS checks whether Full Disk Access is effectively available by probing `~/Library/Mail`.

If missing, the app can open:

- `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`

Granting Full Disk Access improves scan and clean coverage for protected locations.

## Testing

- Unit tests target cleaner logic (`tests/unit`).
- E2E tests run UI smoke coverage with mocked `window.cleanos` (`tests/e2e/ui.test.js`).

Run all unit tests:

```bash
npm test
```

Run UI smoke tests:

```bash
npm run test:e2e
```

## Platform Status

- Current backend implementation: macOS.
- UI and architecture are structured so other OS backends can be added behind the same scan/clean IPC interface.
