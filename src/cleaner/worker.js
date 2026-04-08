const { parentPort } = require('worker_threads');

const cache     = require('./cache');
const logs      = require('./logs');
const trash     = require('./trash');
const browser   = require('./browser');
const developer = require('./developer');
const downloads = require('./downloads');
const system    = require('./system');
const mail      = require('./mail');

const cleaners = { cache, logs, trash, browser, developer, downloads, system, mail };

async function scanOne(category) {
  const mod = cleaners[category];
  if (!mod) throw new Error(`Unknown category: ${category}`);
  return mod.scan();
}

async function scanAll() {
  const results = {};
  await Promise.all(
    Object.entries(cleaners).map(async ([key, mod]) => {
      try {
        results[key] = await mod.scan();
      } catch (err) {
        results[key] = { sizeBytes: 0, fileCount: 0, paths: [], error: err.message };
      }
    })
  );
  return results;
}

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
