jest.mock('../../src/cleaner/utils', () => ({
  walkDir:     jest.fn(),
  totalSize:   jest.fn(),
  deleteFiles: jest.fn(),
  dirExists:   jest.fn(),
  HOME: '/Users/testuser',
}));

jest.mock('child_process', () => ({ execSync: jest.fn() }));

const { walkDir, totalSize, deleteFiles, dirExists } = require('../../src/cleaner/utils');
const childProcess = require('child_process');
const fs  = require('fs');
const os  = require('os');
const system = require('../../src/cleaner/system');

const THREE_DAYS_AGO = Date.now() - (4 * 24 * 60 * 60 * 1000);
const NOW            = Date.now() - 1000;

beforeEach(() => {
  jest.resetAllMocks();
  dirExists.mockReturnValue(false);
  walkDir.mockReturnValue([]);
  totalSize.mockReturnValue(0);
  deleteFiles.mockReturnValue({ deleted: 0, failed: [] });
  childProcess.execSync.mockReturnValue('');
  jest.spyOn(fs, 'readdirSync').mockReturnValue([]);
  jest.spyOn(os, 'tmpdir').mockReturnValue('/private/var/folders/xx/tmp/T');
});

afterEach(() => jest.restoreAllMocks());

// ── snapshot parsing ──────────────────────────────────────────────────────────

describe('snapshot scanning', () => {
  test('parses snapshot names and includes those older than 1 hour', async () => {
    childProcess.execSync.mockImplementation((cmd) => {
      if (cmd.includes('listlocalsnapshots')) {
        return 'com.apple.TimeMachine.2024-11-15-143022.local\n';
      }
      return '';
    });
    dirExists.mockReturnValue(false);

    const result = await system.scan();
    expect(result.snapshots.count).toBe(1);
  });

  test('returns zero snapshots when tmutil output is empty', async () => {
    childProcess.execSync.mockImplementation((cmd) => {
      if (cmd.includes('listlocalsnapshots')) return '';
      return '';
    });
    dirExists.mockReturnValue(false);

    const result = await system.scan();
    expect(result.snapshots.count).toBe(0);
  });

  test('returns zero snapshots when tmutil throws', async () => {
    childProcess.execSync.mockImplementation((cmd) => {
      if (cmd.includes('listlocalsnapshots')) throw new Error('tmutil not found');
      return '';
    });
    dirExists.mockReturnValue(false);

    const result = await system.scan();
    expect(result.snapshots.count).toBe(0);
  });
});

// ── stale temp files ──────────────────────────────────────────────────────────

describe('stale temp file scanning', () => {
  test('includes temp entries older than 3 days', async () => {
    dirExists.mockImplementation(p => p.includes('T'));
    fs.readdirSync.mockReturnValue([
      { name: 'old-build', isFile: () => false, isDirectory: () => true },
    ]);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: THREE_DAYS_AGO, isDirectory: () => true, isFile: () => false });
    walkDir.mockReturnValue(['/private/var/folders/xx/tmp/T/old-build/artifact.o']);
    totalSize.mockReturnValue(8 * 1024 * 1024);

    const result = await system.scan();
    expect(result.fileCount).toBe(1);
    expect(result.sizeBytes).toBe(8 * 1024 * 1024);
  });

  test('excludes temp entries modified within the last 3 days', async () => {
    dirExists.mockImplementation(p => p.includes('T'));
    fs.readdirSync.mockReturnValue([
      { name: 'fresh-entry', isFile: () => true, isDirectory: () => false },
    ]);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: NOW, isDirectory: () => false, isFile: () => true });

    const result = await system.scan();
    expect(result.fileCount).toBe(0);
    expect(result.paths).toHaveLength(0);
  });

  test('returns zero when tmp dir does not exist', async () => {
    dirExists.mockReturnValue(false);
    const result = await system.scan();
    expect(result.fileCount).toBe(0);
    expect(result.sizeBytes).toBe(0);
  });
});

// ── clean ─────────────────────────────────────────────────────────────────────

describe('clean', () => {
  test('dry run returns preview shape without deleting or running tmutil delete', async () => {
    childProcess.execSync.mockImplementation((cmd) => {
      if (cmd.includes('listlocalsnapshots')) return 'com.apple.TimeMachine.2024-11-15-143022.local\n';
      return '';
    });
    dirExists.mockImplementation(p => p.includes('T'));
    fs.readdirSync.mockReturnValue([
      { name: 'stale', isFile: () => true, isDirectory: () => false },
    ]);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: THREE_DAYS_AGO, isDirectory: () => false, isFile: () => true });
    walkDir.mockReturnValue([]);
    totalSize.mockReturnValue(1024);

    const result = await system.clean({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.snapshots.count).toBe(1);
    // tmutil deletelocalsnapshots should NOT have been called
    expect(childProcess.execSync).not.toHaveBeenCalledWith(
      expect.stringContaining('deletelocalsnapshots'),
      expect.anything()
    );
    expect(deleteFiles).not.toHaveBeenCalled();
  });

  test('real clean deletes temp files and calls tmutil deletelocalsnapshots', async () => {
    childProcess.execSync.mockImplementation((cmd) => {
      if (cmd.includes('listlocalsnapshots')) return 'com.apple.TimeMachine.2024-11-15-143022.local\n';
      return '';
    });
    dirExists.mockImplementation(p => p.includes('T'));
    fs.readdirSync.mockReturnValue([
      { name: 'stale-file', isFile: () => true, isDirectory: () => false },
    ]);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: THREE_DAYS_AGO, isDirectory: () => false, isFile: () => true });
    walkDir.mockReturnValue([]);
    totalSize.mockReturnValue(2048);
    deleteFiles.mockReturnValue({ deleted: 1, failed: [] });

    const result = await system.clean({ dryRun: false });

    expect(childProcess.execSync).toHaveBeenCalledWith(
      expect.stringContaining('deletelocalsnapshots'),
      expect.any(Object)
    );
    expect(result.dryRun).toBe(false);
    expect(result.snapshots.deleted).toBe(1);
  });

  test('real clean reports snapshot deletion failures without throwing', async () => {
    childProcess.execSync.mockImplementation((cmd) => {
      if (cmd.includes('listlocalsnapshots')) return 'com.apple.TimeMachine.2024-11-15-143022.local\n';
      if (cmd.includes('deletelocalsnapshots')) throw new Error('permission denied');
      return '';
    });
    dirExists.mockReturnValue(false);

    const result = await system.clean({ dryRun: false });
    expect(result.snapshots.failed).toHaveLength(1);
    expect(result.snapshots.deleted).toBe(0);
  });
});
