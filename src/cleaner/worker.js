// Worker thread for long-running scan/clean tasks.
// Keeps the UI responsive by running filesystem work off the main thread.
const { parentPort } = require('worker_threads');

const cache      = require('./cache');
const logs       = require('./logs');
const trash      = require('./trash');
const browser    = require('./browser');
const developer  = require('./developer');
const downloads  = require('./downloads');
const system     = require('./system');
const mail       = require('./mail');
const appsupport = require('./appsupport');
const simulator  = require('./simulator');
const imessage   = require('./imessage');

// Registry of available cleaning modules keyed by category name.
const cleaners = { cache, logs, trash, browser, developer, downloads, system, mail, appsupport, simulator, imessage };

// Maximum number of category scans running at the same time.
// 4 keeps disk I/O busy without creating a queue of 11 competing traversals.
const SCAN_CONCURRENCY = 4;

// Per-category scan timeout — prevents one slow/hung directory from
// blocking the whole scan indefinitely.
const SCAN_TIMEOUT_MS = 30_000;

// ── Utilities ─────────────────────────────────────────────────────────────────

// Run async tasks over `items` with at most `limit` in flight at once.
// Preserves no particular order — first available slot takes the next item.
async function concurrentMap(items, fn, limit) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  }
  const poolSize = Math.min(limit, items.length || 1);
  await Promise.all(Array.from({ length: poolSize }, worker));
}

// Reject with a timeout error if `promise` doesn't settle within `ms`.
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} scan timed out after ${ms / 1000}s`)),
      ms,
    );
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

// Run a single category scan.
async function scanOne(category) {
  const mod = cleaners[category];
  if (!mod) throw new Error(`Unknown category: ${category}`);
  return mod.scan();
}

// Scan all categories with bounded concurrency and per-category timeouts.
async function scanAll() {
  const entries = Object.entries(cleaners);
  const results = {};

  await concurrentMap(entries, async ([key, mod]) => {
    try {
      results[key] = await withTimeout(mod.scan(), SCAN_TIMEOUT_MS, key);
    } catch (err) {
      results[key] = { sizeBytes: 0, fileCount: 0, paths: [], error: err.message };
    }
  }, SCAN_CONCURRENCY);

  return results;
}

// Clean the selected categories sequentially to reduce disk contention during writes.
async function cleanMany(categories, opts = { dryRun: true }) {
  const results = {};
  for (const key of categories || []) {
    const mod = cleaners[key];
    if (!mod) continue;
    try {
      results[key] = await mod.clean(opts);
    } catch (err) {
      results[key] = { cleaned: false, error: err.message };
    }
  }
  return results;
}

// ── Message handler ───────────────────────────────────────────────────────────

function describeAction(msg) {
  if (!msg || !msg.action) return 'unknown action';
  if (msg.action === 'scan') return `scan(${msg.category || 'unknown'})`;
  if (msg.action === 'scan-all') return 'scan-all()';
  if (msg.action === 'clean') {
    const count = Array.isArray(msg.categories) ? msg.categories.length : 0;
    return `clean(${count} categories, dryRun=${!!msg?.opts?.dryRun})`;
  }
  return String(msg.action);
}

parentPort.on('message', async (msg) => {
  try {
    let result;
    switch (msg?.action) {
      case 'scan':
        result = await scanOne(msg.category);
        break;
      case 'scan-all':
        result = await scanAll();
        break;
      case 'clean':
        result = await cleanMany(msg.categories, msg.opts);
        break;
      default:
        throw new Error('Unknown worker action');
    }
    parentPort.postMessage({ ok: true, result });
  } catch (err) {
    const context = describeAction(msg);
    const message = err?.message || String(err);
    parentPort.postMessage({ ok: false, error: `Worker ${context} failed: ${message}` });
  }
});
