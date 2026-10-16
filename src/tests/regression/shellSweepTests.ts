import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { GlobalSearchService } from '../../services/system/globalSearch.service.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { createTestCustomer } from '../fixtures/factories.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Closing sweep, app shell (server part): the global search text cap and phone match (OBS-R2-99) and the page limit of
 * the list routes (OBS-R2-100). Each test is red on v10.1.53.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

const CUSTOMERS_ONLY = { items: false, customers: true, documents: false, projects: false };

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return { get: (url: string) => request(app).get(url).set('Cookie', s.cookie) };
}

async function runCase(results: TestCaseResult[], id: string, name: string, body: () => Promise<string>): Promise<void> {
  const tStart = Date.now();
  try {
    const details = await body();
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

function assertNoProblems(problems: string[]): void {
  if (problems.length > 0) throw new Error(problems.join(' | '));
}

/** Nine digits no other test row is likely to hold: the subscriber part of a «9xx» mobile number */
function uniqueMobileDigits(): string {
  const clock = String(Date.now() % 1_000_000).padStart(6, '0');
  return `9${clock}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
}

export async function runShellSweepTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('obs_r2_99_global_search_q_cap', 'global search', 'shell sweep')) {
    await runCase(results, 'obs_r2_99_global_search_q_cap', 'OBS-R2-99: a global search text over 100 characters is refused with 400', async () => {
      const admin = await adminClient();
      const long = await admin.get(`/api/global-search?q=${encodeURIComponent('a'.repeat(101))}`);
      const atCap = await admin.get(`/api/global-search?q=${encodeURIComponent('a'.repeat(100))}`);
      const problems: string[] = [];
      if (long.status !== 400) problems.push(`a 101-character search answered ${long.status}, expected 400`);
      if (atCap.status !== 200) problems.push(`a 100-character search answered ${atCap.status}, expected 200`);
      assertNoProblems(problems);
      return 'the search text is capped at 100 characters';
    });
  }

  if (shouldRun('obs_r2_99_phone_key', 'global search', 'shell sweep', 'phone')) {
    await runCase(results, 'obs_r2_99_phone_key', 'OBS-R2-99: global search finds a customer by any spelling of its phone number', async () => {
      const digits = uniqueMobileDigits();
      const stored = `+98 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
      const customer = await createTestCustomer({ phone: stored });
      try {
        const queries = [
          `0${digits.slice(0, 3)} ${digits.slice(3)}`,
          `0098${digits}`,
          toPersianDigits(`${digits.slice(3, 6)}-${digits.slice(6)}`),
        ];
        const problems: string[] = [];
        for (const q of queries) {
          const found = await GlobalSearchService.search(q, CUSTOMERS_ONLY);
          if (!found.customers.some(c => c.id === customer.id)) problems.push(`the customer with phone ${digits} was not found by query #${queries.indexOf(q) + 1}`);
        }
        assertNoProblems(problems);
        return 'a phone number is matched by its TD-296 key whatever its spelling';
      } finally {
        await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, [customer.id]));
      }
    });
  }

  if (shouldRun('obs_r2_100_list_limit_zero', 'pagination', 'shell sweep')) {
    await runCase(results, 'obs_r2_100_list_limit_zero', 'OBS-R2-100: limit=0 on a paged list answers the default page, not the whole table', async () => {
      const admin = await adminClient();
      const res = await admin.get('/api/customers?page=1&limit=0');
      const problems: string[] = [];
      if (res.status !== 200) problems.push(`the customer list answered ${res.status}`);
      if (res.body?.limit !== 50) problems.push(`limit=0 gave a page limit of ${String(res.body?.limit)}, expected 50`);
      if (!Number.isFinite(res.body?.totalPages)) problems.push(`limit=0 gave ${String(res.body?.totalPages)} pages`);
      assertNoProblems(problems);
      return 'limit=0 is the default page';
    });
  }

  return results;
}
