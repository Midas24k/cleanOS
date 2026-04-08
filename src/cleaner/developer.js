// developer.js — Developer tool cache cleaner (macOS)
//
// Targets:
//   Xcode:
//     ~/Library/Developer/Xcode/DerivedData          — build artifacts (safe, fully regenerated)
//     ~/Library/Developer/Xcode/iOS DeviceSupport    — per-device OS symbol files (large, re-downloadable)
//     ~/Library/Developer/Xcode/watchOS DeviceSupport
//     ~/Library/Developer/CoreSimulator/Caches        — simulator runtime caches
//   Node / JS:
//     ~/.npm/_cacache                                 — npm cache
//     ~/.yarn/cache                                   — yarn v1 cache
//     ~/.pnpm-store                                   — pnpm content store
//     ~/Library/Caches/pnpm                          — pnpm alt location
//   Python:
//     ~/Library/Caches/pip                            — pip wheel/source cache
//   Ruby / iOS:
//     ~/Library/Caches/CocoaPods                      — CocoaPods download cache
//     ~/.cocoapods/repos                              — CocoaPods spec repos (re-cloneable)
//   JVM:
//     ~/.gradle/caches                                — Gradle dependency cache
//   Homebrew:
//     ~/Library/Caches/Homebrew                       — downloaded bottle cache
//
// Safety rules:
//   - Never touch Xcode.app itself or simulator device state (~/Library/Developer/CoreSimulator/Devices)
//   - Only target cache/download dirs, not installed toolchains or project source

const path = require('path');
const fs   = require('fs');
const { walkDir, totalSize, deleteFiles, dirExists, HOME } = require('./utils');

const TARGETS = [
  // Xcode
  { name: 'Xcode DerivedData',       dir: `${HOME}/Library/Developer/Xcode/DerivedData` },
  { name: 'iOS Device Support',      dir: `${HOME}/Library/Developer/Xcode/iOS DeviceSupport` },
  { name: 'watchOS Device Support',  dir: `${HOME}/Library/Developer/Xcode/watchOS DeviceSupport` },
  { name: 'Simulator Caches',        dir: `${HOME}/Library/Developer/CoreSimulator/Caches` },
  // Package managers
  { name: 'npm Cache',               dir: `${HOME}/.npm/_cacache` },
  { name: 'Yarn Cache',              dir: `${HOME}/.yarn/cache` },
  { name: 'pnpm Store',              dir: `${HOME}/.pnpm-store` },
  { name: 'pnpm Cache',              dir: `${HOME}/Library/Caches/pnpm` },
  { name: 'pip Cache',               dir: `${HOME}/Library/Caches/pip` },
  { name: 'CocoaPods Cache',         dir: `${HOME}/Library/Caches/CocoaPods` },
  { name: 'CocoaPods Specs',         dir: `${HOME}/.cocoapods/repos` },
  { name: 'Gradle Cache',            dir: `${HOME}/.gradle/caches` },
  { name: 'Homebrew Cache',          dir: `${HOME}/Library/Caches/Homebrew` },
];

async function scan() {
  const allFiles = [];
  const byTarget = {};

  for (const target of TARGETS) {
    if (!dirExists(target.dir)) continue;
    const files     = walkDir(target.dir);
    const sizeBytes = totalSize(files);
    byTarget[target.name] = { sizeBytes, fileCount: files.length };
    allFiles.push(...files);
  }

  return {
    sizeBytes: totalSize(allFiles),
    fileCount: allFiles.length,
    paths:     allFiles,
    byTarget,
  };
}

async function clean({ dryRun = true } = {}) {
  const { sizeBytes, fileCount, paths, byTarget } = await scan();

  if (dryRun) {
    return {
      dryRun:        true,
      wouldDelete:   fileCount,
      wouldFreeBytes: sizeBytes,
      byTarget,
      preview:       paths.slice(0, 20),
    };
  }

  const { deleted, deletedBytes, failed } = deleteFiles(paths);
  return {
    dryRun:     false,
    deleted,
    freedBytes: deletedBytes,
    byTarget,
    failed,
  };
}

module.exports = { scan, clean };
