import request from 'supertest';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, itemPrices, items } from '../../db/schema.js';
import { withTestMarker } from '../fixtures/testMarker.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Row = Record<string, unknown>;

/**
 * Package 5 (items and pricing), PR E: the Excel export keeps each price list's currency (O12) and the import template
 * comes from the server with the columns the import reads (O8).
 */
export async function runItemExcelExportTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: Ctx) => Promise<string>]> = [
    ['reg_excel_export_currency_per_price_list_td_841',
      'v9.0.207: the item Excel export writes a currency column for each price list, so a rial and a dollar price of one item come back unchanged (TD-841)',
      ['td841', 'excel', 'price', 'currency', 'package5'], currencyRoundTripCase],
    ['reg_excel_template_from_server_td_842',
      'v9.0.208: the Excel import template comes from the server without an export audit row, and the import accepts its sample row (TD-842)',
      ['td842', 'excel', 'template', 'package5'], templateCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    const ctx = await makeCtx();
    try {
      const details = await run(ctx);
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      if (ctx.itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, ctx.itemIds)).catch(() => undefined);
    }
  }
  return results;
}

interface Ctx {
  itemIds: number[];
  post(url: string, body: unknown): Promise<request.Response>;
  get(url: string): Promise<request.Response>;
  serial(): string;
}

async function makeCtx(): Promise<Ctx> {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const admin = await getAdminSession();
  return {
    itemIds: [],
    post: (url, body) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body as object),
    get: (url) => request(app).get(url).set('Cookie', admin.cookie),
    serial: () => String(100 + Math.floor(Math.random() * 900)),
  };
}

async function activePrices(itemId: number): Promise<string> {
  const rows = await orm.select({ title: itemPrices.title, price: itemPrices.price, currency: itemPrices.currency }).from(itemPrices)
    .where(and(eq(itemPrices.itemId, itemId), eq(itemPrices.isDeleted, 0)));
  return rows.map(r => `${r.title}=${r.price.toNumber()} ${r.currency}`).sort().join(', ');
}

/** O12: on v9.0.206 the export had one «واحد ارز» per row (USD here), so re-importing it turned the rial price into dollars. */
async function currencyRoundTripCase(ctx: Ctx): Promise<string> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const it = await createTestItem({ code: `1404-B-${ctx.serial()}-03`, name: withTestMarker('دستبند دو ارزی td841'), category: 'دستبند', stocks: { '': 1 } });
  ctx.itemIds.push(it.id);
  const seed = await ctx.post('/api/items/prices/batch-update', { updates: [
    { itemId: it.id, title: 'عمده', price: 300000, currency: 'IRR' }, { itemId: it.id, title: 'فروشگاه', price: 25, currency: 'USD' }] });
  if (seed.status !== 200) throw new Error(`seed prices ${seed.status} ${JSON.stringify(seed.body)}`);
  const before = await activePrices(it.id);

  const exp = await ctx.get('/api/items/unified-export?type=product');
  const row = (Array.isArray(exp.body?.rows) ? exp.body.rows as Row[] : []).find(r => r['کد کالا'] === it.code);
  if (exp.status !== 200 || !row) throw new Error(`export ${exp.status} without the item`);
  const wrong: string[] = [];
  if (row['ارز - قیمت عمده'] !== 'IRR' || row['ارز - قیمت فروشگاه'] !== 'USD') {
    wrong.push(`currency columns عمده=${String(row['ارز - قیمت عمده'])} فروشگاه=${String(row['ارز - قیمت فروشگاه'])}, row currency ${String(row['واحد ارز'])}`);
  }
  const imp = await ctx.post('/api/items/unified-import', { rows: [row] });
  if (imp.status !== 200) throw new Error(`import ${imp.status} ${JSON.stringify(imp.body)}`);
  const after = await activePrices(it.id);
  if (after !== before) wrong.push(`prices ${before} became ${after} after the export round trip`);
  if (Number(imp.body.pricesCount) !== 0) wrong.push(`the unchanged round trip wrote ${imp.body.pricesCount} prices`);
  if (wrong.length > 0) throw new Error(wrong.join(' | '));
  return `export wrote عمده IRR and فروشگاه USD in their own columns; re-import kept ${after} and wrote no price`;
}

/** O8: on v9.0.207 the browser built the template from the full export (an EXPORT audit row) and the route did not exist. */
async function templateCase(ctx: Ctx): Promise<string> {
  const { codeFormatError } = await import('../../lib/items/itemCodeFormat.js');
  const markRes = await orm.execute(sql`SELECT COALESCE(MAX(id), 0)::int AS id FROM activity_logs`);
  const mark = Number((markRes.rows?.[0] as { id?: number } | undefined)?.id ?? 0);
  const res = await ctx.get('/api/items/excel-template');
  const rows = Array.isArray(res.body?.rows) ? res.body.rows as Row[] : [];
  if (res.status !== 200 || rows.length !== 1) throw new Error(`template ${res.status} with ${rows.length} rows`);
  const sample = rows[0];
  const wrong: string[] = [];
  const exports = await orm.select({ id: activityLogs.id }).from(activityLogs).where(and(gt(activityLogs.id, mark), eq(activityLogs.action, 'EXPORT')));
  if (exports.length > 0) wrong.push(`the template wrote ${exports.length} export audit rows`);
  const formatError = codeFormatError(String(sample['کد کالا']), 'product', String(sample['دسته‌بندی']));
  if (formatError) wrong.push(`sample code: ${formatError}`);
  const warehouseSum = Object.entries(sample).filter(([k]) => k.startsWith('موجودی انبار ')).reduce((s, [, v]) => s + Number(v), 0);
  if (Number(sample['موجودی کل']) !== warehouseSum) wrong.push(`total stock ${String(sample['موجودی کل'])} is not the warehouse sum ${warehouseSum}`);
  const { ItemPricingService } = await import('../../services/items/itemPricing.service.js');
  const { priceListMatcher } = await import('../../lib/items/excelPriceColumns.js');
  for (const title of priceListMatcher(await ItemPricingService.getPricingStrategies()).titles) {
    if (!(`قیمت ${title}` in sample) || sample[`ارز - قیمت ${title}`] !== 'IRR') wrong.push(`price list ${title} lacks its price or currency column`);
  }

  const code = `1404-N-${ctx.serial()}-01`;
  const imp = await ctx.post('/api/items/unified-import', { rows: [{ ...sample, 'کد کالا': code, 'نام محصول': withTestMarker(`گردنبند الگو td842 ${code}`) }] });
  const [created] = await orm.select({ id: items.id }).from(items).where(and(eq(items.code, code), eq(items.isDeleted, 0)));
  if (created) ctx.itemIds.push(created.id);
  const errors = Array.isArray(imp.body?.errors) ? imp.body.errors : [];
  if (imp.status !== 200 || !created || errors.length > 0) wrong.push(`import of the sample answered ${imp.status} with errors ${JSON.stringify(errors)}`);
  if (wrong.length > 0) throw new Error(wrong.join(' | '));
  return `template row with ${Object.keys(sample).length} columns, no export audit row; the import created the sample item without row errors`;
}
