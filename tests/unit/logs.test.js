// Unit tests for log file scanning and deletion rules.
jest.mock('../../src/cleaner/utils', () => ({
  walkDir:     jest.fn(),
  totalSize:   jest.fn(),
  deleteFiles: jest.fn(),
  dirExists:   jest.fn(),
  HOME: '/Users/testuser',
}));

const { walkDir, totalSize, deleteFiles, dirExists } = require('../../src/cleaner/utils');
const fs   = require('fs');
const logs = require('../../src/cleaner/logs');

const ONE_DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  jest.resetAllMocks();
  dirExists.mockReturnValue(false);
  walkDir.mockReturnValue([]);
  totalSize.mockReturnValue(0);
  deleteFiles.mockReturnValue({ deleted: 0, deletedBytes: 0, failed: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── scan ──────────────────────────────────────────────────────────────────────

describe('scan', () => {
  test('includes .log, .gz, .bz2, .old files older than 24h', async () => {
    // Only one log dir exists so walkDir is called once
    dirExists.mockImplementation(p => p === '/var/log');
    walkDir.mockReturnValue([
      '/var/log/system.log',
      '/var/log/install.log.gz',
      '/var/log/auth.log.bz2',
      '/var/log/daily.log.old',
    ]);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() - 2 * ONE_DAY });
    totalSize.mockReturnValue(4096);

    const result = await logs.scan();
    expect(result.paths).toHaveLength(4);
    expect(result.fileCount).toBe(4);
  });

  test('includes rotated logs (.1, .2, etc.) older than 24h', async () => {
    dirExists.mockImplementation(p => p === '/var/log');
    walkDir.mockReturnValue(['/var/log/syslog.1', '/var/log/syslog.2']);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() - 2 * ONE_DAY });
    totalSize.mockReturnValue(512);

    const result = await logs.scan();
    expect(result.paths).toHaveLength(2);
  });

  test('excludes files modified less than 24h ago', async () => {
    dirExists.mockImplementation(p => p === '/var/log');
    walkDir.mockReturnValue(['/var/log/fresh.log']);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() - 1000 }); // 1 second old

    const result = await logs.scan();
    expect(result.paths).toHaveLength(0);
  });

  test('excludes non-log file extensions', async () => {
    dirExists.mockImplementation(p => p === '/var/log');
    walkDir.mockReturnValue(['/var/log/notes.txt', '/var/log/data.json']);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() - 2 * ONE_DAY });

    const result = await logs.scan();
    expect(result.paths).toHaveLength(0);
  });

  test('returns zero when no log dirs exist', async () => {
    const result = await logs.scan();
    expect(result.sizeBytes).toBe(0);
    expect(result.fileCount).toBe(0);
  });
});

// ── clean ─────────────────────────────────────────────────────────────────────

describe('clean', () => {
  test('dry run returns preview shape without deleting', async () => {
    dirExists.mockImplementation(p => p === '/var/log');
    walkDir.mockReturnValue(['/var/log/old.log']);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() - 2 * ONE_DAY });
    totalSize.mockReturnValue(2048);

    const result = await logs.clean({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.wouldDelete).toBe(1);
    expect(result.wouldFreeBytes).toBe(2048);
    expect(deleteFiles).not.toHaveBeenCalled();
  });

  test('real clean only passes writable files to deleteFiles', async () => {
    dirExists.mockImplementation(p => p === '/var/log');
    walkDir.mockReturnValue(['/var/log/user.log', '/var/log/root-only.log']);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() - 2 * ONE_DAY });
    jest.spyOn(fs, 'accessSync').mockImplementation((p) => {
      if (p.includes('root-only')) throw new Error('EACCES: permission denied');
    });
    totalSize.mockReturnValue(4096);
    deleteFiles.mockReturnValue({ deleted: 1, deletedBytes: 2048, failed: [] });

    const result = await logs.clean({ dryRun: false });

    expect(deleteFiles).toHaveBeenCalledWith(['/var/log/user.log']);
    expect(result.deleted).toBe(1);
    expect(result.dryRun).toBe(false);
  });

  test('real clean returns empty deleted count when no writable files', async () => {
    dirExists.mockImplementation(p => p === '/var/log');
    walkDir.mockReturnValue(['/var/log/root-only.log']);
    jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() - 2 * ONE_DAY });
    jest.spyOn(fs, 'accessSync').mockImplementation(() => {
      throw new Error('EACCES');
    });
    totalSize.mockReturnValue(1024);
    deleteFiles.mockReturnValue({ deleted: 0, deletedBytes: 0, failed: [] });

    await logs.clean({ dryRun: false });
    expect(deleteFiles).toHaveBeenCalledWith([]);
  });
});
