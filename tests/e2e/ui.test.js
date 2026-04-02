const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

let electronApp;
let page;

const MOCK_SCAN_DATA = {
  cache:   { sizeBytes: 500 * 1024 * 1024, fileCount: 150, paths: [] },
  logs:    { sizeBytes:  20 * 1024 * 1024, fileCount:  45, paths: [] },
  trash:   { sizeBytes: 200 * 1024 * 1024, fileCount:  30, paths: [] },
  browser: { sizeBytes: 300 * 1024 * 1024, fileCount:  88, paths: [] },
};

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [path.join(__dirname, '../..')],
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
});

// ── Layout ────────────────────────────────────────────────────────────────────

test('app launches and shows CleanOS logo', async () => {
  await expect(page.locator('.logo')).toContainText('CleanOS');
});

test('Smart Scan nav item is active on launch', async () => {
  await expect(page.locator('.nav-item.active')).toContainText('Smart Scan');
});

test('scan button is visible and enabled on launch', async () => {
  await expect(page.locator('#scanBtn')).toBeVisible();
  await expect(page.locator('#scanBtn')).toBeEnabled();
  await expect(page.locator('#scanBtn')).toContainText('Run Scan');
});

// ── Dry Run Toggle ────────────────────────────────────────────────────────────

test('dry run toggle is ON by default', async () => {
  await expect(page.locator('#dryRunToggle')).toBeChecked();
  await expect(page.locator('#dryLabel')).toHaveText('Dry Run ON');
});

test('toggling dry run OFF updates label and clean button text', async () => {
  await page.locator('label.toggle').click();
  await expect(page.locator('#dryRunToggle')).not.toBeChecked();
  await expect(page.locator('#dryLabel')).toHaveText('Dry Run OFF');
  await expect(page.locator('#cleanBtn')).toContainText('Clean Now');
});

test('toggling dry run back ON restores label and button', async () => {
  await page.locator('label.toggle').click();
  await expect(page.locator('#dryRunToggle')).toBeChecked();
  await expect(page.locator('#dryLabel')).toHaveText('Dry Run ON');
  await expect(page.locator('#cleanBtn')).toContainText('Preview Clean');
});

// ── Action Bar ────────────────────────────────────────────────────────────────

test('action bar is hidden before any scan', async () => {
  const classes = await page.locator('#actionBar').getAttribute('class');
  expect(classes).not.toContain('visible');
});

// ── Scan Flow ─────────────────────────────────────────────────────────────────

test('scan overlay appears when scan starts', async () => {
  // Override IPC in the main process to avoid a real filesystem scan
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('scan-all');
    ipcMain.handle('scan-all', () => new Promise(resolve =>
      setTimeout(() => resolve({
        cache:   { sizeBytes: 500 * 1024 * 1024, fileCount: 150, paths: [] },
        logs:    { sizeBytes:  20 * 1024 * 1024, fileCount:  45, paths: [] },
        trash:   { sizeBytes: 200 * 1024 * 1024, fileCount:  30, paths: [] },
        browser: { sizeBytes: 300 * 1024 * 1024, fileCount:  88, paths: [] },
      }), 600)
    ));
  });

  await page.locator('#scanBtn').click();
  await expect(page.locator('#scanOverlay')).toHaveClass(/show/);
});

test('category cards appear after scan completes', async () => {
  await page.waitForSelector('.cat-card', { timeout: 10000 });
  const count = await page.locator('.cat-card').count();
  expect(count).toBe(4);
});

test('action bar is visible after scan with all categories selected', async () => {
  await expect(page.locator('#actionBar')).toHaveClass(/visible/);
});

test('action bar shows total size of selected categories', async () => {
  const size = await page.locator('#totalSize').textContent();
  expect(size).toMatch(/\d+(\.\d+)?\s*(B|KB|MB|GB)/);
});

test('deselect all hides the action bar', async () => {
  await page.locator('.btn-deselect').click();
  const classes = await page.locator('#actionBar').getAttribute('class');
  expect(classes).not.toContain('visible');
});

test('clicking a category card re-shows the action bar', async () => {
  await page.locator('.cat-card').first().click();
  await expect(page.locator('#actionBar')).toHaveClass(/visible/);
});

test('DRY RUN badge is visible in action bar when dry run is on', async () => {
  await expect(page.locator('#dryBadge')).toBeVisible();
});

// ── Clean Flow ────────────────────────────────────────────────────────────────

test('clean result overlay appears after running a dry-run clean', async () => {
  // Override clean IPC handler
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('clean');
    ipcMain.handle('clean', (_event, categories) => {
      const result = {};
      for (const cat of categories) {
        result[cat] = { dryRun: true, wouldDelete: 10, wouldFreeBytes: 1024 * 1024 };
      }
      return result;
    });
  });

  await page.locator('#cleanBtn').click();
  await expect(page.locator('#resultOverlay')).toHaveClass(/show/, { timeout: 5000 });
  await expect(page.locator('#resultTitle')).toContainText('Dry Run');
});

test('dismissing result overlay hides it', async () => {
  // Prevent re-scan after dismiss (dry run dismissal triggers re-scan — mock it)
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('scan-all');
    ipcMain.handle('scan-all', () => Promise.resolve({
      cache:   { sizeBytes: 500 * 1024 * 1024, fileCount: 150, paths: [] },
      logs:    { sizeBytes:  20 * 1024 * 1024, fileCount:  45, paths: [] },
      trash:   { sizeBytes: 200 * 1024 * 1024, fileCount:  30, paths: [] },
      browser: { sizeBytes: 300 * 1024 * 1024, fileCount:  88, paths: [] },
    }));
  });

  await page.locator('.btn-done').click();
  const classes = await page.locator('#resultOverlay').getAttribute('class');
  expect(classes).not.toContain('show');
});
