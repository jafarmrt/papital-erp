// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { packageNameOf, runtimeDependencyIssues } from '../../../scripts/check-runtime-deps';

/**
 * v7.0.84 (TD-177): ایمیج پروداکشن فقط `dependencies` را نصب می‌کند؛ این فهرست باید دقیقاً بسته‌هایی باشد که باندل
 * سرور require می‌کند — نه کمتر (سرور در ایمیج بالا نمی‌آید) و نه بیشتر (React، فونت‌ها و xlsx حجم بی‌مورد بودند).
 */
describe('runtime dependencies (TD-177)', () => {
  it('maps import specifiers to package names', () => {
    expect(packageNameOf('drizzle-orm/pg-core')).toBe('drizzle-orm');
    expect(packageNameOf('@tanstack/react-query')).toBe('@tanstack/react-query');
    expect(packageNameOf('node:fs')).toBeNull();
    expect(packageNameOf('fs/promises')).toBeNull();
    expect(packageNameOf('./local')).toBeNull();
  });

  it('dependencies equal the packages required by the server bundle', async () => {
    const issues = await runtimeDependencyIssues();
    expect(issues).toEqual({ missing: [], unused: [] });
  }, 60000);
});
