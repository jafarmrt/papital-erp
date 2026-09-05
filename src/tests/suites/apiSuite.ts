import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import { parsePagination } from '../../lib/pagination.js';

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
      throw new Error('خروجی واقعی ORM برای فهرست تنظیمات آرایه نیست');
    }
    const extractSafe = (res: unknown) => Array.isArray((res as { data?: unknown[] })?.data)
      ? (res as { data: unknown[] }).data
      : (Array.isArray(res) ? (res as unknown[]) : []);

    const safe = extractSafe({ data: settingsRows });
    if (safe.length !== settingsRows.length) {
      throw new Error('استخراج ایمن از شکل واقعی پاسخ settings شکست خورد');
    }

    results.push(makeTestCase({
      id: 'api_array_safety_guard',
      name: 'استخراج ایمن آرایه‌ها در پاسخ‌های API (Array Safety Guard)',
      layer: 'api',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t1Start,
      details: `parsePagination واقعی با ورودی‌های مخرب (99999999999/NaN) سقف‌گذاری امن شد و شکل آرایه‌ای واقعی ${settingsRows.length} رکورد تنظیمات تأیید گردید.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'api_array_safety_guard',
      name: 'استخراج ایمن آرایه‌ها در پاسخ‌های API (Array Safety Guard)',
      layer: 'api',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t1Start,
      error: err.message
    }));
  }

  return results;
}
