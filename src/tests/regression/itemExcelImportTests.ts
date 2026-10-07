import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { itemPrices, items } from '../../db/schema.js';
import { withTestMarker } from '../fixtures/testMarker.js';
import { money } from '../../lib/money.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Row = Record<string, unknown>;

/**
 * Package 5 (items and pricing), PR A: the unified Excel import / export of items and the pricing page quick import.
 * Each case reproduces a finding of the package 5 review and failed on the version before its fix.
 */
export async function runItemExcelImportTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: Ctx) => Promise<string>]> = [
    ['reg_excel_roundtrip_no_cost_price_list_td_647',
      'v9.0.114: only configured price lists are prices in Excel import, the pricing quick import and the invoice price list; migration 0063 cleans the three non-price titles (TD-647)',
      ['td647', 'excel', 'price', 'package5'], priceListColumnsCase],
    ['reg_excel_reimport_keeps_price_history_td_662',
      'v9.0.115: re-importing an unchanged Excel file rewrites no price row (TD-662)',
      ['td662', 'excel', 'price', 'package5'], unchangedPriceCase],
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

async function activeTitles(itemId: number): Promise<string[]> {
  const rows = await orm.select({ title: itemPrices.title }).from(itemPrices)
    .where(and(eq(itemPrices.itemId, itemId), eq(itemPrices.isDeleted, 0)));
  return rows.map(r => r.title).sort();
}

async function priceRowCount(itemId: number): Promise<number> {
  return (await orm.select({ id: itemPrices.id }).from(itemPrices).where(eq(itemPrices.itemId, itemId))).length;
}

/** TD-662 / B05-16: on v9.0.114 each import of the same file soft-deleted and re-inserted every price (history 2 → 6). */
async function unchangedPriceCase(ctx: Ctx): Promise<string> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const it = await createTestItem({ code: `1404-B-${ctx.serial()}-02`, name: withTestMarker('دستبند تاریخچه td662'), category: 'دستبند', stocks: { '': 2 } });
  ctx.itemIds.push(it.id);
  const seed = await ctx.post('/api/items/prices/batch-update', { updates: [
    { itemId: it.id, title: 'عمده', price: 300000 }, { itemId: it.id, title: 'فروشگاه', price: 420000 }] });
  if (seed.status !== 200) throw new Error(`seed prices ${seed.status}`);
  const before = await priceRowCount(it.id);
  const row = { 'کد کالا': it.code, 'نام محصول': it.name, 'قیمت عمده': 300000, 'قیمت فروشگاه': 420000, 'واحد ارز': 'IRR' };
  const counts: number[] = [];
  for (let i = 0; i < 2; i++) {
    const imp = await ctx.post('/api/items/unified-import', { rows: [row] });
    if (imp.status !== 200) throw new Error(`import ${imp.status} ${JSON.stringify(imp.body)}`);
    counts.push(Number(imp.body.pricesCount));
  }
  const after = await priceRowCount(it.id);
  const changed = await ctx.post('/api/items/unified-import', { rows: [{ ...row, 'قیمت عمده': 310000 }] });
  const afterChange = await priceRowCount(it.id);
  if (after !== before || counts.some(c => c !== 0) || changed.body.pricesCount !== 1 || afterChange !== before + 1) {
    throw new Error(`price rows ${before} → ${after} after two unchanged imports (pricesCount ${counts.join(',')}); a changed price → ${afterChange} (pricesCount ${changed.body.pricesCount})`);
  }
  return `price rows stayed ${before} after two unchanged imports; one changed price added one row`;
}

/** TD-647 / B05-01: on v9.0.113 the unchanged export round trip added the price list «میانگین خرید (WAC)» and the quick import «موجودی کل». */
async function priceListColumnsCase(ctx: Ctx): Promise<string> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const { findUnknownPriceTitles } = await import('../../services/items/itemPriceTitles.js');
  const wrong: string[] = [];
  const it = await createTestItem({ code: `1404-N-${ctx.serial()}-01`, name: withTestMarker('گردنبند رفت‌وبرگشت td647'), category: 'گردنبند', weightedAverageCost: 1250000, stocks: { '': 4 } });
  ctx.itemIds.push(it.id);
  const seed = await ctx.post('/api/items/prices/batch-update', { updates: [
    { itemId: it.id, title: 'عمده', price: 2000000 }, { itemId: it.id, title: 'فروشگاه', price: 2600000 }] });
  if (seed.status !== 200) throw new Error(`seed prices ${seed.status} ${JSON.stringify(seed.body)}`);

  // a) unchanged round trip of the unified export
  const exp = await ctx.get('/api/items/unified-export?type=product');
  const row = (exp.body.rows as Row[]).find(r => r['کد کالا'] === it.code);
  if (!row) throw new Error('item missing from the unified export');
  if (Object.keys(row).some(k => k.includes('WAC'))) wrong.push(`export header still says WAC: ${Object.keys(row).filter(k => k.includes('WAC')).join(', ')}`);
  const imp = await ctx.post('/api/items/unified-import', { rows: [row], typeFilter: 'product' });
  if (imp.status !== 200) wrong.push(`round trip import ${imp.status}`);
  const titles = await activeTitles(it.id);
  if (JSON.stringify(titles) !== JSON.stringify(['عمده', 'فروشگاه'])) wrong.push(`active titles after the round trip ${JSON.stringify(titles)}`);
  const api = await ctx.get(`/api/items/${it.id}/prices`);
  const apiTitles = (api.body as Row[]).map(p => String(p.title)).sort();
  if (JSON.stringify(apiTitles) !== JSON.stringify(['عمده', 'فروشگاه'])) wrong.push(`GET /items/:id/prices titles ${JSON.stringify(apiTitles)}`);

  // b) an old export header and an unknown «قیمت …» column
  const imp2 = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': it.code, 'نام محصول': it.name, 'قیمت میانگین خرید (WAC)': 1250000, 'قیمت ویژه همکار': 900000 }] });
  const unknownErr = (imp2.body.errors as Array<{ message: string }> | undefined)?.some(e => e.message.includes('قیمت ویژه همکار'));
  if (!unknownErr) wrong.push(`unknown price column not reported: ${JSON.stringify(imp2.body.errors)}`);
  const titles2 = await activeTitles(it.id);
  if (titles2.some(t => t !== 'عمده' && t !== 'فروشگاه')) wrong.push(`unknown or WAC column became a price list: ${JSON.stringify(titles2)}`);

  // c) the pricing page quick import payload and the server guard
  const { buildQuickPriceUpdates } = await import('../../lib/items/quickPriceImport.js');
  const quick = buildQuickPriceUpdates([{ 'کد کالا': it.code, 'موجودی کل': 12, 'میانگین بهای خرید': 700000, 'قیمت عمده': 950000 }], [{ id: it.id, code: it.code }], ['فروشگاه', 'مصرف‌کننده', 'عمده']);
  if (quick.updates.length !== 1 || quick.updates[0].title !== 'عمده') wrong.push(`quick import updates ${JSON.stringify(quick.updates)}`);
  const stockAsPrice = await ctx.post('/api/items/prices/batch-update', { updates: [{ itemId: it.id, title: 'موجودی کل', price: 12 }] });
  if (stockAsPrice.status !== 422 || stockAsPrice.body?.code !== 'PRICE_LIST_NOT_CONFIGURED') wrong.push(`batch-update «موجودی کل» answered ${stockAsPrice.status} ${stockAsPrice.body?.code}`);
  const single = await ctx.post(`/api/items/${it.id}/prices`, { title: 'میانگین خرید (WAC)', price: 1250000 });
  if (single.status !== 422) wrong.push(`POST /items/:id/prices «میانگین خرید (WAC)» answered ${single.status}`);

  // d) legacy rows: hidden from the invoice price list, cleaned by migration 0063 or listed by the health check
  const legacy = await orm.insert(itemPrices).values([
    { itemId: it.id, title: 'میانگین خرید (WAC)', price: money(1250000), currency: 'IRR', isDeleted: 0 },
    { itemId: it.id, title: 'موجودی کل', price: money(12), currency: 'IRR', isDeleted: 0 },
    { itemId: it.id, title: 'تخفیف نمایشگاه td647', price: money(800000), currency: 'IRR', isDeleted: 0 },
  ]).returning({ id: itemPrices.id, title: itemPrices.title });
  const api2 = await ctx.get(`/api/items/${it.id}/prices`);
  const apiTitles2 = (api2.body as Row[]).map(p => String(p.title)).sort();
  if (JSON.stringify(apiTitles2) !== JSON.stringify(['عمده', 'فروشگاه'])) wrong.push(`legacy titles reach the invoice price list ${JSON.stringify(apiTitles2)}`);
  const sqlText = fs.readFileSync(path.resolve(process.cwd(), 'drizzle/0063_item_price_non_list_titles.sql'), 'utf8');
  for (const stmt of sqlText.split('--> statement-breakpoint').slice(1)) await pool.query(stmt);
  const after = await orm.select({ id: itemPrices.id, isDeleted: itemPrices.isDeleted }).from(itemPrices).where(inArray(itemPrices.id, legacy.map(l => l.id)));
  const deleted = after.filter(r => r.isDeleted === 1).map(r => legacy.find(l => l.id === r.id)?.title).sort();
  if (JSON.stringify(deleted) !== JSON.stringify(['موجودی کل', 'میانگین خرید (WAC)'].sort())) wrong.push(`migration 0063 soft-deleted ${JSON.stringify(deleted)}`);
  const recorded = await pool.query('SELECT item_price_id, price::text FROM item_price_title_cleanup WHERE item_id = $1 ORDER BY item_price_id', [it.id]);
  if (recorded.rowCount !== 2) wrong.push(`migration 0063 recorded ${recorded.rowCount} rows`);
  const unknown = await findUnknownPriceTitles();
  if (!unknown.some(u => u.title === 'تخفیف نمایشگاه td647')) wrong.push('health check does not list the unknown title');

  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return `round trip kept ${JSON.stringify(titles)}; unknown column reported; quick import 1 update; batch «موجودی کل» 422; migration cleaned 2, health lists the rest`;
}
