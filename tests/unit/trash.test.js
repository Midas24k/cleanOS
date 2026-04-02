jest.mock('../../src/cleaner/utils', () => ({
  walkDir:     jest.fn(),
  totalSize:   jest.fn(),
  deleteFiles: jest.fn(),
  dirExists:   jest.fn(),
  HOME: '/Users/testuser',
}));

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

const { walkDir, totalSize, deleteFiles, dirExists } = require('../../src/cleaner/utils');
const childProcess = require('child_process');
const fs    = require('fs');
const trash = require('../../src/cleaner/trash');

beforeEach(() => {
  jest.resetAllMocks();
  dirExists.mockReturnValue(false);
  walkDir.mockReturnValue([]);
  totalSize.mockReturnValue(0);
  deleteFiles.mockReturnValue({ deleted: 0, failed: [] });
  childProcess.execSync.mockReturnValue('');
  // Prevent reading real /Volumes by default
  jest.spyOn(fs, 'readdirSync').mockReturnValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── scan ──────────────────────────────────────────────────────────────────────

describe('scan', () => {
  test('scans ~/.Trash and returns file list', async () => {
    dirExists.mockImplementation(p => p === '/Users/testuser/.Trash');
    walkDir.mockReturnValue(['/Users/testuser/.Trash/old-file.dmg']);
    totalSize.mockReturnValue(512 * 1024 * 1024);

    const result = await trash.scan();
    expect(result.fileCount).toBe(1);
    expect(result.sizeBytes).toBe(512 * 1024 * 1024);
    expect(result.paths).toContain('/Users/testuser/.Trash/old-file.dmg');
  });

  test('includes files from external volume trash when accessible', async () => {
    jest.spyOn(fs, 'readdirSync').mockReturnValue(['MyDrive']);
    dirExists.mockImplementation(p =>
      p.includes('.Trash') || p.includes('.Trashes')
    );
    walkDir
      .mockReturnValueOnce(['/Users/testuser/.Trash/file.zip'])
      .mockReturnValueOnce(['/Volumes/MyDrive/.Trashes/501/old.dmg']);
    totalSize.mockReturnValue(1024);

    const result = await trash.scan();
    expect(result.fileCount).toBe(2);
  });

  test('returns zero when trash is empty or inaccessible', async () => {
    const result = await trash.scan();
    expect(result.sizeBytes).toBe(0);
    expect(result.fileCount).toBe(0);
    expect(result.paths).toEqual([]);
  });
});

// ── clean ─────────────────────────────────────────────────────────────────────

describe('clean', () => {
  test('dry run returns preview shape without deleting', async () => {
    dirExists.mockImplementation(p => p === '/Users/testuser/.Trash');
    walkDir.mockReturnValue(['/Users/testuser/.Trash/junk.zip']);
    totalSize.mockReturnValue(1024);

    const result = await trash.clean({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.wouldDelete).toBe(1);
    expect(result.wouldFreeBytes).toBe(1024);
    expect(deleteFiles).not.toHaveBeenCalled();
  });

  test('real clean uses osascript (Finder) as the primary method', async () => {
    dirExists.mockImplementation(p => p === '/Users/testuser/.Trash');
    walkDir.mockReturnValue(['/Users/testuser/.Trash/junk.zip']);
    totalSize.mockReturnValue(1024);
    childProcess.execSync.mockReturnValue('');

    const result = await trash.clean({ dryRun: false });

    expect(childProcess.execSync).toHaveBeenCalledWith(
      expect.stringContaining('osascript'),
      expect.any(Object)
    );
    expect(result.method).toBe('osascript');
    expect(result.deleted).toBe(1);
  });

  test('real clean falls back to manual delete if osascript throws', async () => {
    dirExists.mockImplementation(p => p === '/Users/testuser/.Trash');
    walkDir.mockReturnValue(['/Users/testuser/.Trash/junk.zip']);
    totalSize.mockReturnValue(1024);
    childProcess.execSync.mockImplementation(() => {
      throw new Error('osascript not available');
    });
    deleteFiles.mockReturnValue({ deleted: 1, failed: [] });

    const result = await trash.clean({ dryRun: false });

    expect(deleteFiles).toHaveBeenCalled();
    expect(result.method).toBe('manual');
    expect(result.deleted).toBe(1);
  });
});
