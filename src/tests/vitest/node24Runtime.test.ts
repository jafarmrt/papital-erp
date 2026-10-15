// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * v10.1.24 (I-07, product-owner decision ت۳۲): the app is built, tested and shipped on Node.js 24 LTS. CI, the
 * Docker image, the installer, `.nvmrc` and `engines` name the same major, so no place keeps building on Node 22.
 */
const read = (path: string) => readFileSync(path, 'utf8');
const NODE_MAJOR = '24';

describe('Node.js 24 everywhere (I-07)', () => {
  it('every CI job sets up Node 24', () => {
    const versions = [...read('.github/workflows/ci.yml').matchAll(/node-version:\s*'(\d+)'/g)].map(m => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set([NODE_MAJOR]));
  });

  it('every Docker stage starts from node:24-alpine', () => {
    const bases = [...read('Dockerfile').matchAll(/^FROM\s+(\S+)/gm)].map(m => m[1]);
    expect(bases.length).toBe(3);
    for (const base of bases) expect(base).toBe(`public.ecr.aws/docker/library/node:${NODE_MAJOR}-alpine`);
  });

  it('the installer installs Node 24 and upgrades an older Node', () => {
    const install = read('install.sh');
    expect(install).toContain(`setup_${NODE_MAJOR}.x`);
    expect(install).not.toMatch(/setup_2[0-3]\.x/);
    expect(install).toContain(`-lt ${NODE_MAJOR} ]`);
  });

  it('.nvmrc and engines name Node 24', () => {
    expect(read('.nvmrc').trim()).toBe(NODE_MAJOR);
    const pkg = JSON.parse(read('package.json')) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe(`>=${NODE_MAJOR}`);
  });
});
