/**
 * v10.1.2 (TD-1261): on a loaded two-core CI runner the 5 s test timeout and Testing Library's 1 s wait flaked
 * (accountingQueryCache, permissionRatchet, uiWordingRatchet), and making jsdom again for every file took 41% of the run.
 * The Vitest configuration gives every test and hook 30 s, every findBy* / waitFor 5 s through the setup file, and runs
 * the files in the vmForks pool (one jsdom per worker, each file still in its own context, process.env.TZ still honoured);
 * no test file may pass a shorter timeout of its own.
 */
import fs from 'fs';
import path from 'path';
import { getConfig } from '@testing-library/dom';
import { describe, expect, it } from 'vitest';
import { ASYNC_UTIL_TIMEOUT_MS } from './setup/testingLibrary';

const TEST_DIR = path.join(process.cwd(), 'src/tests/vitest');
const MIN_OWN_TIMEOUT_MS = 10_000;
const THIS_FILE = 'vitestCiStabilityTd1261.test.ts';

// read as text: importing vitest/config loads esbuild, which refuses to run inside jsdom
const CONFIG = fs.readFileSync(path.join(process.cwd(), 'vitest.config.ts'), 'utf8');
const configNumber = (key: string) => Number(new RegExp(`\\b${key}:\\s*([\\d_]+)`).exec(CONFIG)?.[1].replace(/_/g, '') ?? 0);

/** Timeouts a test file passes itself: `{ timeout: n }` of findBy* / waitFor and `}, n);` closing an it() */
function ownTimeouts(source: string): number[] {
  const values = [
    ...[...source.matchAll(/\btimeout:\s*([\d_]+)\b/g)].map(m => m[1]),
    ...[...source.matchAll(/^\s*\},\s*([\d_]+)\);\s*$/gm)].map(m => m[1]),
  ];
  return values.map(v => Number(v.replace(/_/g, '')));
}

describe('vitest_ci_stability_td_1261', () => {
  it('gives every test and hook 30 s, loads the Testing Library setup and runs in the vmForks pool', () => {
    expect(configNumber('testTimeout')).toBeGreaterThanOrEqual(30_000);
    expect(configNumber('hookTimeout')).toBeGreaterThanOrEqual(30_000);
    expect(CONFIG).toMatch(/setupFiles:\s*\['src\/tests\/vitest\/setup\/testingLibrary\.ts'\]/);
    expect(CONFIG).toMatch(/\bpool:\s*'vmForks'/);
  });

  it('findBy* and waitFor wait 5 s by default in a jsdom test file', () => {
    expect(ASYNC_UTIL_TIMEOUT_MS).toBe(5_000);
    expect(getConfig().asyncUtilTimeout).toBe(ASYNC_UTIL_TIMEOUT_MS);
  });

  it('reads the timeouts a test file passes itself', () => {
    const source = [
      "await waitFor(() => check(), { timeout: 3000 });",
      "await screen.findByText('x', {}, { timeout: 2_000 });",
      '  }, 20_000);',
      '    const linked = link(schedule([{ id: 1 }]), 9);',
    ].join('\n');
    expect(ownTimeouts(source)).toEqual([3000, 2000, 20000]);
  });

  it('no test file passes a timeout shorter than 10 s', () => {
    const short = fs.readdirSync(TEST_DIR)
      .filter(name => /\.test\.tsx?$/.test(name) && name !== THIS_FILE)
      .flatMap(name => ownTimeouts(fs.readFileSync(path.join(TEST_DIR, name), 'utf8'))
        .filter(ms => ms < MIN_OWN_TIMEOUT_MS)
        .map(ms => `${name}: ${ms} ms`));
    expect(short).toEqual([]);
  });
});
