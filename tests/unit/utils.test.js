const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { walkDir, totalSize, deleteFiles, dirExists } = require('../../src/cleaner/utils');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanos-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── walkDir ───────────────────────────────────────────────────────────────────

describe('walkDir', () => {
  test('returns all files in a flat directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b');
    const files = walkDir(tmpDir);
    expect(files).toHaveLength(2);
    expect(files).toEqual(expect.arrayContaining([
      path.join(tmpDir, 'a.txt'),
      path.join(tmpDir, 'b.txt'),
    ]));
  });

  test('recurses into subdirectories', () => {
    const sub = path.join(tmpDir, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'c.txt'), 'c');
    const files = walkDir(tmpDir);
    expect(files).toContain(path.join(sub, 'c.txt'));
  });

  test('skips symlinks', () => {
    const real = path.join(tmpDir, 'real.txt');
    fs.writeFileSync(real, 'real');
    fs.symlinkSync(real, path.join(tmpDir, 'link.txt'));
    const files = walkDir(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(real);
  });

  test('returns empty array for non-existent directory', () => {
    expect(walkDir('/nonexistent/cleanos-xyz')).toEqual([]);
  });

  test('returns empty array for empty directory', () => {
    expect(walkDir(tmpDir)).toEqual([]);
  });
});

// ── totalSize ─────────────────────────────────────────────────────────────────

describe('totalSize', () => {
  test('sums sizes of multiple files', () => {
    const f1 = path.join(tmpDir, 'a.txt');
    const f2 = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(f1, 'hello');   // 5 bytes
    fs.writeFileSync(f2, 'world!!'); // 7 bytes
    expect(totalSize([f1, f2])).toBe(12);
  });

  test('returns 0 for an empty array', () => {
    expect(totalSize([])).toBe(0);
  });

  test('skips non-existent files without throwing', () => {
    expect(totalSize(['/nonexistent/file.dat'])).toBe(0);
  });
});

// ── deleteFiles ───────────────────────────────────────────────────────────────

describe('deleteFiles', () => {
  test('deletes a file and returns correct count', () => {
    const f = path.join(tmpDir, 'del.txt');
    fs.writeFileSync(f, 'bye');
    const { deleted, deletedBytes, failed } = deleteFiles([f]);
    expect(deleted).toBe(1);
    expect(deletedBytes).toBeGreaterThan(0);
    expect(failed).toHaveLength(0);
    expect(fs.existsSync(f)).toBe(false);
  });

  test('records failed deletions without throwing', () => {
    const { deleted, deletedBytes, failed } = deleteFiles(['/nonexistent/nope.txt']);
    expect(deleted).toBe(0);
    expect(deletedBytes).toBe(0);
    expect(failed).toHaveLength(1);
    expect(failed[0].path).toBe('/nonexistent/nope.txt');
    expect(failed[0].error).toBeDefined();
  });

  test('handles mixed success and failure', () => {
    const good = path.join(tmpDir, 'good.txt');
    fs.writeFileSync(good, 'ok');
    const { deleted, deletedBytes, failed } = deleteFiles([good, '/nonexistent/bad.txt']);
    expect(deleted).toBe(1);
    expect(deletedBytes).toBeGreaterThan(0);
    expect(failed).toHaveLength(1);
  });

  test('returns zero counts for empty array', () => {
    const { deleted, deletedBytes, failed } = deleteFiles([]);
    expect(deleted).toBe(0);
    expect(deletedBytes).toBe(0);
    expect(failed).toHaveLength(0);
  });
});

// ── dirExists ─────────────────────────────────────────────────────────────────

describe('dirExists', () => {
  test('returns true for an existing readable directory', () => {
    expect(dirExists(os.tmpdir())).toBe(true);
  });

  test('returns false for a non-existent path', () => {
    expect(dirExists('/nonexistent/cleanos-test-xyz')).toBe(false);
  });
});
