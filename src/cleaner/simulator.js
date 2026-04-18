// simulator.js — iOS Simulator cleanup (macOS)
//
// Targets: device records in ~/Library/Developer/CoreSimulator/Devices/
//   whose runtime is no longer installed (isAvailable: false in simctl).
//
// Safety rules:
//   - Never touches available (working) simulators
//   - Uses `xcrun simctl delete unavailable` as the primary deletion path
//     so CoreSimulator's own state machine handles the removal cleanly
//   - Falls back to manual file removal if xcrun is not present

const path = require('path');
const { execSync } = require('child_process');
const { walkDir, totalSize, deleteFiles, dirExists, HOME } = require('./utils');

const DEVICES_DIR = path.join(HOME, 'Library', 'Developer', 'CoreSimulator', 'Devices');

// Return UDIDs of unavailable simulator devices via xcrun simctl.
function unavailableUdids() {
  try {
    const out = execSync('xcrun simctl list devices --json', {
      timeout: 10000,
      stdio: 'pipe',
    }).toString();
    const data = JSON.parse(out);
    const udids = [];
    for (const devices of Object.values(data.devices || {})) {
      for (const device of devices) {
        if (!device.isAvailable) udids.push(device.udid);
      }
    }
    return udids;
  } catch {
    return [];
  }
}

async function scan() {
  if (!dirExists(DEVICES_DIR)) {
    return { sizeBytes: 0, fileCount: 0, paths: [], deviceCount: 0 };
  }

  const udids    = unavailableUdids();
  const allFiles = [];

  for (const udid of udids) {
    const devicePath = path.join(DEVICES_DIR, udid);
    if (!dirExists(devicePath)) continue;
    allFiles.push(...walkDir(devicePath));
  }

  return {
    sizeBytes:   totalSize(allFiles),
    fileCount:   allFiles.length,
    paths:       allFiles,
    deviceCount: udids.length,
  };
}

async function clean({ dryRun = true } = {}) {
  const { sizeBytes, fileCount, paths, deviceCount } = await scan();

  if (dryRun) {
    return {
      dryRun:         true,
      wouldDelete:    fileCount,
      wouldFreeBytes: sizeBytes,
      deviceCount,
      preview:        paths.slice(0, 20),
    };
  }

  // Official path: xcrun handles CoreSimulator state correctly
  try {
    execSync('xcrun simctl delete unavailable', { timeout: 60000, stdio: 'pipe' });
    const after  = await scan();
    const freed  = Math.max(0, sizeBytes - after.sizeBytes);
    return {
      dryRun:     false,
      deleted:    deviceCount - after.deviceCount,
      freedBytes: freed,
      failed:     [],
    };
  } catch {
    // xcrun unavailable — fall back to manual file deletion
    const { deleted, deletedBytes, failed } = await deleteFiles(paths);
    return { dryRun: false, deleted, freedBytes: deletedBytes, failed };
  }
}

module.exports = { scan, clean };
