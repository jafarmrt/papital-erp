import fs from 'fs';
import path from 'path';

export interface AppBuildInfo {
  version: string;
  gitCommit: string;
  buildTime: string;
  environment: string;
  nodeVersion: string;
}

function resolvePackageVersion(): string {
  // 1. Explicit environment variable takes precedence (CI/CD, Container, Cloud Run)
  if (process.env.APP_VERSION && process.env.APP_VERSION.trim().length > 0) {
    return process.env.APP_VERSION.trim();
  }

  // 2. npm runtime environment variable
  if (process.env.npm_package_version && process.env.npm_package_version.trim().length > 0) {
    return process.env.npm_package_version.trim();
  }

  // 3. Dynamic filesystem resolution of package.json (Single Source of Truth)
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.version && typeof parsed.version === 'string') {
        return parsed.version;
      }
    }
  } catch {
    // Ignore filesystem access exceptions in restricted sandboxes
  }

  // 4. Default baseline fallback
  return '4.0.0';
}

/**
 * v9.0.152 (TD-601): commit and build time come from `dist/build-info.json`, written by
 * `scripts/write-build-info.mjs` at the end of `npm run build`; environment variables still win. Without
 * either they are `unknown` (the old defaults were a fixed, wrong commit name and date).
 */
export const BUILD_INFO_FILE = 'build-info.json';

function readBuiltInfo(): { gitCommit?: string; buildTime?: string } {
  try {
    const file = path.resolve(process.cwd(), 'dist', BUILD_INFO_FILE);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { gitCommit?: unknown; buildTime?: unknown };
    return {
      gitCommit: typeof parsed.gitCommit === 'string' ? parsed.gitCommit : undefined,
      buildTime: typeof parsed.buildTime === 'string' ? parsed.buildTime : undefined,
    };
  } catch {
    return {};
  }
}

const builtInfo = readBuiltInfo();

export const APP_VERSION: string = resolvePackageVersion();
export const GIT_COMMIT_SHA: string = process.env.GIT_COMMIT_SHA || process.env.COMMIT_SHA || builtInfo.gitCommit || 'unknown';
export const BUILD_TIMESTAMP: string = process.env.BUILD_TIMESTAMP || builtInfo.buildTime || 'unknown';

export const BUILD_INFO: AppBuildInfo = Object.freeze({
  version: APP_VERSION,
  gitCommit: GIT_COMMIT_SHA,
  buildTime: BUILD_TIMESTAMP,
  environment: process.env.NODE_ENV || 'development',
  nodeVersion: process.version
});
