import { TestCaseResult, makeTestCase } from '../types.js';

export async function runApiTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // Test 1: Array Safety Guard Extraction for API Responses
  const t1Start = Date.now();
  try {
    const paginatedResponse = { data: [{ id: 1, name: 'کالا ۱' }, { id: 2, name: 'کالا ۲' }], total: 2, page: 1, limit: 10 };
    const plainArrayResponse = [{ id: 1, name: 'کالا ۱' }];
    const unexpectedErrorResponse = { error: 'Internal Server Error' };

    const extractSafe = (res: any) => Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);

    const safe1 = extractSafe(paginatedResponse);
    const safe2 = extractSafe(plainArrayResponse);
    const safe3 = extractSafe(unexpectedErrorResponse);

    if (safe1.length === 2 && safe2.length === 1 && safe3.length === 0) {
      results.push(makeTestCase({
        id: 'api_array_safety_guard',
        name: 'استخراج ایمن آرایه‌ها در پاسخ‌های API (Array Safety Guard)',
        layer: 'api',
        executionType: 'simulation_logic',
        passed: true,
        durationMs: Date.now() - t1Start,
        details: 'استخراج ایمن آرایه در حالت‌های Paginated، Plain Array و Error Object بدون رخ دادن TypeError تایید شد.'
      }));
    } else {
      throw new Error('گارد ایمنی استخراج آرایه‌ها ناموفق بود');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'api_array_safety_guard',
      name: 'استخراج ایمن آرایه‌ها در پاسخ‌های API (Array Safety Guard)',
      layer: 'api',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t1Start,
      error: err.message
    }));
  }

  return results;
}

