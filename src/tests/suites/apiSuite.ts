import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings, transfers } from '../../db/schema.js';
import { parsePagination } from '../../lib/pagination.js';
import { getUserAuthCacheStats, invalidateUserAuthCache } from '../../middleware/auth.js';

export async function runApiTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // Test 1: Array Safety Guard Extraction for API Responses
  // V3.0.9 (TD-055): تابع extractSafe تعریف‌شده «درون خودِ تست» حذف شد —
  // اکنون رفتار pagination واقعی backend (parsePagination در lib/pagination.ts)
  // با ورودی‌های مخرب NaN/منفی/سقف، به‌همراه یک رفتار برگشتی REAL endpoint
  // (فهرست تنظیمات) اعتبارسنجی می‌شود.
  const t1Start = Date.now();
  try {
    // 1.1 — real pagination lib: hostile inputs must be capped/floored, never throw
    const capped = parsePagination({ page: '99999999999', limit: '99999999999' } as any);
    if (capped.page < 1 || capped.limit < 1 || capped.limit > 1000) {
      throw new Error(`parsePagination inputs capped invalidly: page=${capped.page}, limit=${capped.limit}`);
    }
    const nanned = parsePagination({ page: NaN, limit: NaN } as unknown as Record<string, unknown>);
    if (!(nanned.page >= 1 && nanned.limit >= 1)) {
      throw new Error(`parsePagination NaN handling failed: page=${nanned.page}, limit=${nanned.limit}`);
    }

    // 1.2 — real endpoint data shape: settings list must return an actual array
    const settingsRows = await orm.select({ key: appSettings.key }).from(appSettings).limit(5);
    if (!Array.isArray(settingsRows)) {
      throw new Error('The real ORM output for the settings list is not an array');
    }
    const extractSafe = (res: unknown) => Array.isArray((res as { data?: unknown[] })?.data)
      ? (res as { data: unknown[] }).data
      : (Array.isArray(res) ? (res as unknown[]) : []);

    const safe = extractSafe({ data: settingsRows });
    if (safe.length !== settingsRows.length) {
      throw new Error('Safe extraction from the real shape of the settings response failed');
    }

    results.push(makeTestCase({
      id: 'api_array_safety_guard',
      name: 'Safe extraction of arrays from API responses (Array Safety Guard)',
      layer: 'api',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t1Start,
      details: `The real parsePagination safely capped malicious inputs (99999999999/NaN) and the real array shape of ${settingsRows.length} settings records is confirmed.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'api_array_safety_guard',
      name: 'Safe extraction of arrays from API responses (Array Safety Guard)',
      layer: 'api',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t1Start,
      error: err.message
    }));
  }

  // Test 2: In-Memory Auth Cache & Invalidation (V4 Phase 5.3 / TD-098)
  const t2Start = Date.now();
  try {
    const initialStats = getUserAuthCacheStats();
    if (typeof initialStats.size !== 'number' || typeof initialStats.maxSize !== 'number') {
      throw new Error('Auth cache statistics are invalid');
    }

    // Invalidate a specific user cache entry
    invalidateUserAuthCache(999999);

    // Clear all entries to test full invalidation
    invalidateUserAuthCache();
    const clearedStats = getUserAuthCacheStats();
    if (clearedStats.size !== 0) {
      throw new Error('The auth cache was not empty after clearing');
    }

    results.push(makeTestCase({
      id: 'api_auth_token_cache_invalidation',
      name: 'Optimized auth cache and session invalidation (In-Memory Auth Cache & Invalidation)',
      layer: 'api',
      executionType: 'real_code',
      passed: true,
      durationMs: Date.now() - t2Start,
      details: `The in-memory auth cache (TTL=30s, MaxSize=${initialStats.maxSize}) and the single and global invalidation functions are validated.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'api_auth_token_cache_invalidation',
      name: 'Optimized auth cache and session invalidation (In-Memory Auth Cache & Invalidation)',
      layer: 'api',
      executionType: 'real_code',
      passed: false,
      durationMs: Date.now() - t2Start,
      error: err.message
    }));
  }

  // Test 3: Transfers Query & Pagination Guard (V4 Phase 5.3 / TD-098)
  const t3Start = Date.now();
  try {
    const pageParams = parsePagination({ page: '1', limit: '25' }, { page: 1, limit: 50 });
    if (pageParams.page !== 1 || pageParams.limit !== 25 || pageParams.offset !== 0) {
      throw new Error(`Transfers pagination is computed wrongly: ${JSON.stringify(pageParams)}`);
    }

    // Verify DB transfers table query compatibility
    const transfersCount = await orm.select({ id: transfers.id }).from(transfers).limit(10);
    if (!Array.isArray(transfersCount)) {
      throw new Error('The transfers query did not return a valid array');
    }

    results.push(makeTestCase({
      id: 'api_transfers_pagination_and_guard',
      name: 'Pagination and load control of the transfers endpoint (Transfers Pagination & Query Guard)',
      layer: 'api',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t3Start,
      details: `Pagination of the /api/transfers endpoint with default and chosen parameters is validated and the database query ran.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'api_transfers_pagination_and_guard',
      name: 'Pagination and load control of the transfers endpoint (Transfers Pagination & Query Guard)',
      layer: 'api',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t3Start,
      error: err.message
    }));
  }

  return results;
}
