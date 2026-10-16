import request from 'supertest';
import { CustomerService } from '../../services/customer.service.js';
import { TestCaseResult, makeTestCase } from '../types.js';
import { makeDailyLogTestCtx } from './dailyLogAccessTests.js';

/**
 * v10.1.51 closing sweep, daily log and customer observations (packages 13 and 9): each test is red on v10.1.45.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

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

// Persian «ی» / «ک» and Persian digits are stored; the search is typed with Arabic «ي» / «ك» and Arabic-Indic digits
const STORED_TITLE = 'گزارش کیک ۴۷۱۹ یکشنبه';
const ARABIC_SEARCH = 'كيك ٤٧١٩';
const ARABIC_TAG_SEARCH = 'برچسب‌كار';

export async function runDailyLogCustomerSweepTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const searchId = 'reg_daily_log_search_folds_arabic_letters_digits_obs_r2_61';
  if (shouldRun(searchId, 'obs-r2-61', 'daily_log', 'daily', 'search')) {
    await runCase(results, searchId, 'v10.1.51: the daily log search folds Arabic letters and digits like global search (OBS-R2-61)', async () => {
      const ctx = await makeDailyLogTestCtx();
      try {
        const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
        const logId = await ctx.insertLog(author, { title: STORED_TITLE, content: 'p13 sweep', tags: ['برچسب‌کار'] });
        const byTitle = await ctx.send(author, 'get', `/api/daily-logs?filter_type=mine&search=${encodeURIComponent(ARABIC_SEARCH)}`);
        const byTag = await ctx.send(author, 'get', `/api/daily-logs?filter_type=mine&search=${encodeURIComponent(ARABIC_TAG_SEARCH)}`);
        const ids = (res: { body?: { data?: Array<{ id: number }> } }) => (Array.isArray(res.body?.data) ? res.body.data.map(r => r.id) : []);
        assertNoProblems([
          ...(byTitle.status === 200 ? [] : [`the search answered ${byTitle.status}`]),
          ...(ids(byTitle).includes(logId) ? [] : ['a search with Arabic ye/kaf and Arabic-Indic digits does not find the Persian title']),
          ...(ids(byTag).includes(logId) ? [] : ['a search with Arabic kaf does not find the Persian tag']),
        ]);
        return 'the Persian title and tag are found by an Arabic-letter, Arabic-digit search';
      } finally {
        await ctx.cleanup();
      }
    });
  }

  const rowId = 'reg_customer_import_error_names_excel_row_obs_r2_25';
  if (shouldRun(rowId, 'obs-r2-25', 'customer', 'import', 'excel')) {
    await runCase(results, rowId, 'v10.1.51: a customer import error names the Excel row, header included (OBS-R2-25)', async () => {
      const plain = await CustomerService.bulkImport([{ name: '' }], true);
      const sent = await CustomerService.bulkImport([{ name: '', sheetRow: 7 }], true);
      assertNoProblems([
        ...(plain.errors[0]?.row === 2 ? [] : [`the first data row is reported as row ${plain.errors[0]?.row}, expected Excel row 2`]),
        ...(sent.errors[0]?.row === 7 ? [] : [`a row sent with its sheet row 7 is reported as row ${sent.errors[0]?.row}`]),
        ...(plain.createdCount + sent.createdCount === 0 ? [] : ['a row without a name was written']),
      ]);
      return 'first data row = Excel row 2; a filtered row keeps its own Excel row number';
    });
  }

  const galleryId = 'reg_item_list_gallery_page_filters_obs_r2_62';
  if (shouldRun(galleryId, 'obs-r2-62', 'gallery', 'items', 'image')) {
    await runCase(results, galleryId, 'v10.1.51: the item list pages the gallery on the server: items with a picture, one category (OBS-R2-62)', async () => {
      const { createTestItem } = await import('../fixtures/factories.js');
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const tag = `GAL${String(Date.now()).slice(-6)}`;
      const withPicture = await createTestItem({ code: `${tag}A`, category: 'انگشتر', image: '/uploads/a.png' });
      const thumbOnly = await createTestItem({ code: `${tag}B`, category: 'انگشتر', thumbnail: '/uploads/b.png' });
      const noPicture = await createTestItem({ code: `${tag}C`, category: 'انگشتر' });
      const otherCategory = await createTestItem({ code: `${tag}D`, category: 'دستبند', image: '/uploads/d.png' });
      const app = await getTestApp();
      const s = await getAdminSession();
      const res = await request(app).get(`/api/items?type=product&image=1&category=${encodeURIComponent('انگشتر')}&search=${tag}&page=1&limit=50`).set('Cookie', s.cookie);
      const ids = Array.isArray(res.body?.data) ? (res.body.data as Array<{ id: number }>).map(r => r.id) : [];
      assertNoProblems([
        ...(res.status === 200 ? [] : [`the list answered ${res.status}`]),
        ...(ids.includes(withPicture.id) && ids.includes(thumbOnly.id) ? [] : ['an item with a picture or a thumbnail is missing']),
        ...(ids.includes(noPicture.id) ? ['an item without a picture is listed'] : []),
        ...(ids.includes(otherCategory.id) ? ['an item of another category is listed'] : []),
        ...(res.body?.total === 2 ? [] : [`total ${res.body?.total}, expected 2`]),
      ]);
      return 'image=1 and category keep the two pictured items of the category, counted in SQL';
    });
  }

  return results;
}
