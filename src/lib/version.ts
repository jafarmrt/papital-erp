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

export const APP_VERSION: string = resolvePackageVersion();
export const GIT_COMMIT_SHA: string = process.env.GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'v4-master';
export const BUILD_TIMESTAMP: string = process.env.BUILD_TIMESTAMP || '2026-09-05T06:30:00.000Z';

export const BUILD_INFO: AppBuildInfo = Object.freeze({
  version: APP_VERSION,
  gitCommit: GIT_COMMIT_SHA,
  buildTime: BUILD_TIMESTAMP,
  environment: process.env.NODE_ENV || 'development',
  nodeVersion: process.version
});

export function getAppVersion(): string {
  return APP_VERSION;
}

export function getBuildInfo(): AppBuildInfo {
  return BUILD_INFO;
}
