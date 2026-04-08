jest.mock('../../src/cleaner/utils', () => ({
  walkDir:     jest.fn(),
  totalSize:   jest.fn(),
  deleteFiles: jest.fn(),
  dirExists:   jest.fn(),
  HOME: '/Users/testuser',
}));

const { walkDir, totalSize, deleteFiles, dirExists } = require('../../src/cleaner/utils');
const browser = require('../../src/cleaner/browser');

beforeEach(() => {
  jest.resetAllMocks();
  dirExists.mockReturnValue(false);
  walkDir.mockReturnValue([]);
  totalSize.mockReturnValue(0);
  deleteFiles.mockReturnValue({ deleted: 0, deletedBytes: 0, failed: [] });
});

// ── scan ──────────────────────────────────────────────────────────────────────

describe('scan', () => {
  test('returns zero counts when no browser cache dirs exist', async () => {
    const result = await browser.scan();
    expect(result.sizeBytes).toBe(0);
    expect(result.fileCount).toBe(0);
    expect(result.paths).toEqual([]);
  });

  test('returns a byBrowser breakdown for all tracked browsers', async () => {
    const result = await browser.scan();
    expect(result.byBrowser).toBeDefined();
    expect(result.byBrowser).toHaveProperty('Chrome');
    expect(result.byBrowser).toHaveProperty('Firefox');
    expect(result.byBrowser).toHaveProperty('Safari');
    expect(result.byBrowser).toHaveProperty('Brave');
    expect(result.byBrowser).toHaveProperty('Edge');
  });

  test('scans Chrome cache dirs when they exist', async () => {
    dirExists.mockImplementation(p => p.includes('Google/Chrome'));
    walkDir.mockReturnValue(['/path/chrome/cache/file']);
    totalSize.mockReturnValue(500);

    const result = await browser.scan();
    expect(result.byBrowser['Chrome'].fileCount).toBeGreaterThan(0);
  });

  test('scans Safari cache dirs when they exist', async () => {
    dirExists.mockImplementation(p => p.includes('com.apple.Safari') || p.includes('com.apple.WebKit'));
    walkDir.mockReturnValue(['/path/safari/cache/file']);
    totalSize.mockReturnValue(200);

    const result = await browser.scan();
    expect(result.byBrowser['Safari'].fileCount).toBeGreaterThan(0);
  });

  test('aggregates all files into top-level paths and fileCount', async () => {
    dirExists.mockImplementation(p => p.includes('Google/Chrome') || p.includes('Microsoft Edge'));
    walkDir.mockReturnValue(['/some/cache/file']);
    totalSize.mockReturnValue(1024);

    const result = await browser.scan();
    expect(result.fileCount).toBeGreaterThan(0);
  });
});

// ── clean ─────────────────────────────────────────────────────────────────────

describe('clean', () => {
  test('dry run returns preview shape without calling deleteFiles', async () => {
    dirExists.mockImplementation(p => p.includes('Google/Chrome'));
    walkDir.mockReturnValue(['/path/chrome/cache/junk']);
    totalSize.mockReturnValue(2048);

    const result = await browser.clean({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.wouldFreeBytes).toBe(2048);
    expect(result.wouldDelete).toBeGreaterThan(0);
    expect(deleteFiles).not.toHaveBeenCalled();
  });

  test('real clean calls deleteFiles with collected cache files', async () => {
    dirExists.mockImplementation(p => p.includes('Google/Chrome'));
    walkDir.mockReturnValue(['/path/chrome/cache/junk']);
    totalSize.mockReturnValue(2048);
    deleteFiles.mockReturnValue({ deleted: 3, deletedBytes: 2048, failed: [] });

    const result = await browser.clean({ dryRun: false });

    expect(result.dryRun).toBe(false);
    expect(deleteFiles).toHaveBeenCalled();
    expect(result.deleted).toBe(3);
  });

  test('real clean includes per-browser breakdown in result', async () => {
    dirExists.mockImplementation(p => p.includes('Google/Chrome'));
    walkDir.mockReturnValue(['/path/chrome/cache/junk']);
    totalSize.mockReturnValue(1024);
    deleteFiles.mockReturnValue({ deleted: 1, deletedBytes: 1024, failed: [] });

    const result = await browser.clean({ dryRun: false });
    expect(result.byBrowser).toBeDefined();
    expect(result.byBrowser['Chrome']).toBeDefined();
  });
});
