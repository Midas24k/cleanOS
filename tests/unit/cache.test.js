// Unit tests for cache scanning and skip rules.
jest.mock('../../src/cleaner/utils', () => ({
  walkDir:     jest.fn(),
  totalSize:   jest.fn(),
  deleteFiles: jest.fn(),
  dirExists:   jest.fn(),
  HOME: '/Users/testuser',
}));

const { walkDir, totalSize, deleteFiles, dirExists } = require('../../src/cleaner/utils');
const cache = require('../../src/cleaner/cache');

beforeEach(() => {
  jest.resetAllMocks();
  dirExists.mockReturnValue(false);
  walkDir.mockReturnValue([]);
  totalSize.mockReturnValue(0);
  deleteFiles.mockReturnValue({ deleted: 0, deletedBytes: 0, failed: [] });
});

// ── scan ──────────────────────────────────────────────────────────────────────

describe('scan', () => {
  test('returns zero counts when no cache dirs exist', async () => {
    const result = await cache.scan();
    expect(result.sizeBytes).toBe(0);
    expect(result.fileCount).toBe(0);
    expect(result.paths).toEqual([]);
  });

  test('excludes files in protected subdirectories (Safari, TCC, akd)', async () => {
    dirExists.mockReturnValue(true);
    walkDir.mockImplementation(dir => [
      `${dir}/com.apple.Safari/some.cache`,
      `${dir}/com.apple.TCC/db.sqlite`,
      `${dir}/com.apple.akd/token`,
      `${dir}/com.apple.MyApp/data.cache`,
    ]);
    totalSize.mockReturnValue(1024);

    const result = await cache.scan();
    expect(result.paths.every(p => !p.includes('com.apple.Safari'))).toBe(true);
    expect(result.paths.every(p => !p.includes('com.apple.TCC'))).toBe(true);
    expect(result.paths.every(p => !p.includes('com.apple.akd'))).toBe(true);
    expect(result.paths.some(p => p.includes('com.apple.MyApp'))).toBe(true);
  });

  test('aggregates files from user and system cache dirs', async () => {
    dirExists.mockReturnValue(true);
    walkDir
      .mockReturnValueOnce(['/Users/testuser/Library/Caches/a.cache'])
      .mockReturnValueOnce(['/Library/Caches/b.cache']);
    totalSize.mockReturnValue(2048);

    const result = await cache.scan();
    expect(result.fileCount).toBe(2);
    expect(result.sizeBytes).toBe(2048);
  });

  test('returns paths array for dry-run preview', async () => {
    dirExists.mockReturnValue(true);
    walkDir.mockReturnValue(['/Users/testuser/Library/Caches/junk.dat']);
    totalSize.mockReturnValue(512);

    const result = await cache.scan();
    expect(result.paths).toContain('/Users/testuser/Library/Caches/junk.dat');
  });
});

// ── clean ─────────────────────────────────────────────────────────────────────

describe('clean', () => {
  test('dry run returns preview shape without calling deleteFiles', async () => {
    // Only the user cache dir exists — prevents walkDir being called twice
    dirExists.mockImplementation(p => p.includes('testuser/Library/Caches'));
    walkDir.mockReturnValue(['/Users/testuser/Library/Caches/junk.dat']);
    totalSize.mockReturnValue(1024);

    const result = await cache.clean({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.wouldDelete).toBe(1);
    expect(result.wouldFreeBytes).toBe(1024);
    expect(deleteFiles).not.toHaveBeenCalled();
  });

  test('real clean calls deleteFiles with the scanned file list', async () => {
    const file = '/Users/testuser/Library/Caches/junk.dat';
    dirExists.mockImplementation(p => p.includes('testuser/Library/Caches'));
    walkDir.mockReturnValue([file]);
    totalSize.mockReturnValue(1024);
    deleteFiles.mockReturnValue({ deleted: 1, deletedBytes: 1024, failed: [] });

    const result = await cache.clean({ dryRun: false });

    expect(result.dryRun).toBe(false);
    expect(result.deleted).toBe(1);
    expect(result.freedBytes).toBe(1024);
    expect(result.failed).toHaveLength(0);
    expect(deleteFiles).toHaveBeenCalledWith([file]);
  });

  test('real clean reports partial failures', async () => {
    dirExists.mockReturnValue(true);
    walkDir.mockReturnValue(['/a.cache', '/b.cache']);
    totalSize.mockReturnValue(2048);
    deleteFiles.mockReturnValue({ deleted: 1, deletedBytes: 1024, failed: [{ path: '/b.cache', error: 'EACCES' }] });

    const result = await cache.clean({ dryRun: false });
    expect(result.deleted).toBe(1);
    expect(result.failed).toHaveLength(1);
  });
});
