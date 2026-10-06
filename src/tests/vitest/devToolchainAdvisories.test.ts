// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * v9.0.1 (TD-414): گیت امنیتی CI (`npm run audit:gate`) روی vitest@3.2.7 قرمز بود — tinypool@1.1.1 با دو هشدار
 * بحرانی (GHSA-5gmw-xhrv-c9v3، GHSA-85c8-ppgw-ccpr) و @vitest/mocker با هشدار متوسط (GHSA-82fw-gwwq-j7x9).
 * این تست نسخه‌های قفل‌شده در package-lock.json را با کمینه نسخه وصله‌شده هر هشدار مقایسه می‌کند تا بازگشت به
 * زنجیره آسیب‌پذیر بدون اجرای npm audit (که شبکه لازم دارد) هم شکست بخورد.
 */
const PATCHED_MINIMUMS: Record<string, string> = {
  tinypool: '2.1.2',
  vitest: '4.1.11',
  '@vitest/mocker': '4.1.11',
};

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).slice(0, 3).map(Number);
  const pb = b.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function lockedVersionsBelowPatch(): string[] {
  const lock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };
  const issues: string[] = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    const name = key.split('node_modules/').pop() ?? '';
    const minimum = PATCHED_MINIMUMS[name];
    if (minimum && entry.version && compareVersions(entry.version, minimum) < 0) {
      issues.push(`${key}@${entry.version} < ${minimum}`);
    }
  }
  return issues;
}

describe('dev toolchain advisories (TD-414)', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.1.1', '2.1.2')).toBeLessThan(0);
    expect(compareVersions('4.1.11', '4.1.9')).toBeGreaterThan(0);
    expect(compareVersions('5.0.3', '4.1.11')).toBeGreaterThan(0);
    expect(compareVersions('2.1.2', '2.1.2')).toBe(0);
  });

  it('locks no vitest, @vitest/mocker or tinypool version below its patched release', () => {
    expect(lockedVersionsBelowPatch()).toEqual([]);
  });
});
