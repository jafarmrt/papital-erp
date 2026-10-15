// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * v10.1.22 (OBS-PR-01, ledger row TD-983): drizzle-kit 0.31 still lists `@esbuild-kit/esm-loader`, whose `core-utils` pinned
 * esbuild 0.18 with the moderate advisory GHSA-67mh-4wv8-2f99. An npm override gives it the project's own esbuild,
 * so the lock file holds no esbuild older than 0.25 and `npm audit` reports nothing.
 */
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { version?: string }> };
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  devDependencies: Record<string, string>;
  overrides?: Record<string, unknown>;
};

const minorOf = (version: string) => {
  const [major, minor] = version.split('.').map(Number);
  return major * 1000 + minor;
};

describe('drizzle-kit esbuild chain (OBS-PR-01)', () => {
  it('no esbuild in the lock file is older than 0.25', () => {
    const old = Object.entries(lock.packages)
      .filter(([path]) => path === 'node_modules/esbuild' || path.endsWith('/node_modules/esbuild'))
      .filter(([, entry]) => minorOf(entry.version ?? '0.0.0') < 25)
      .map(([path, entry]) => `${path}@${entry.version}`);
    expect(old).toEqual([]);
  });

  it('the override gives @esbuild-kit/core-utils the root esbuild and drizzle-kit is the latest stable line', () => {
    expect(pkg.overrides?.['@esbuild-kit/core-utils']).toEqual({ esbuild: '$esbuild' });
    expect(lock.packages['node_modules/drizzle-kit']?.version).toBe('0.31.11');
  });
});
