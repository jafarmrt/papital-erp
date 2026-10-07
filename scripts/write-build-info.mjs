#!/usr/bin/env node
// v9.0.152 (TD-601): writes <outDir>/build-info.json (default dist/) with the commit and time of this build;
// src/lib/version.ts reads it for the build details of /health. Runs at the end of `npm run build`.
// Usage: node scripts/write-build-info.mjs [outDir]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || 'dist');

function gitCommit() {
  if (process.env.GIT_COMMIT_SHA) return process.env.GIT_COMMIT_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

const info = { gitCommit: gitCommit(), buildTime: new Date().toISOString() };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`Build info written: commit ${info.gitCommit}, time ${info.buildTime}`);
