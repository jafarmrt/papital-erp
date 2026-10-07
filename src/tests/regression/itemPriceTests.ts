import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, itemPrices, activityLogs } from '../../db/schema.js';
import { money } from '../../lib/money.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * Package 5 (items and pricing), PR C: item prices (one active price per list under concurrency, price amount and
 * currency). Each case reproduces a finding of the package 5 review.
 */
export async function runItemPriceTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: Ctx) => Promise<string>]> = [
    ['conc_item_price_single_active_td_660',
      'v9.0.165: concurrent saves of one price list leave one active price, through POST /items/:id/prices and batch-update (TD-660)',
      ['td660', 'item', 'price', 'concurrency', 'package5'], singleActiveCase],
    ['reg_item_price_amount_currency_td_657',
      'v9.0.166: a price is a decimal above zero in a supported currency, removal is explicit, and the Excel import refuses a row with an invalid price (TD-657, price part)',
      ['td657', 'item', 'price', 'validation', 'package5'], amountCurrencyCase],
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
  /** random digits that keep the codes and names of one run apart */
  tag: string;
  /** items created through POST /api/items, soft-deleted after the case */
  itemIds: number[];
  post(url: string, body: unknown): Promise<request.Response>;
  get(url: string): Promise<request.Response>;
}

async function makeCtx(): Promise<Ctx> {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const admin = await getAdminSession();
  const itemIds: number[] = [];
  return {
    tag: String(100 + Math.floor(Math.random() * 900)),
    itemIds,
    post: async (url, body) => {
      const res = await request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body as object);
      if (url === '/api/items' && res.status === 200 && typeof res.body?.id === 'number') itemIds.push(res.body.id);
      return res;
    },
    get: (url) => request(app).get(url).set('Cookie', admin.cookie),
  };
}

async function newItem(ctx: Ctx, suffix: string): Promise<number> {
  const res = await ctx.post('/api/items', { type: 'raw_material', code: `PR-${ctx.tag}${suffix}`, name: `کالای قیمت ${ctx.tag} ${suffix}`, unit: 'عدد', category: 'سایر اقلام' });
  if (res.status !== 200) throw new Error(`item create answered ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as number;
}

async function activeRows(itemId: number) {
  return orm.select({ id: itemPrices.id, title: itemPrices.title, price: itemPrices.price }).from(itemPrices)
    .where(and(eq(itemPrices.itemId, itemId), eq(itemPrices.isDeleted, 0)));
}

async function singleActiveCase(ctx: Ctx): Promise<string> {
  const wrong: string[] = [];
  // a) five concurrent single saves of «عمده» with different amounts
  const first = await newItem(ctx, '1');
  const singles = await Promise.all([1, 2, 3, 4, 5].map(i => ctx.post(`/api/items/${first}/prices`, { title: 'عمده', price: i * 100000 })));
  const singleRows = await activeRows(first);
  if (singles.some(r => r.status !== 200)) wrong.push(`single saves answered ${singles.map(r => r.status).join(',')}`);
  if (singleRows.length !== 1) wrong.push(`single saves left ${singleRows.length} active rows ${JSON.stringify(singleRows.map(r => r.price))}`);

  // b) five concurrent batch saves of a list the item has no price for yet
  const second = await newItem(ctx, '2');
  const batches = await Promise.all([1, 2, 3, 4, 5].map(i => ctx.post('/api/items/prices/batch-update', { updates: [{ itemId: second, title: 'فروشگاه', price: i * 200000 }] })));
  const batchRows = await activeRows(second);
  if (batches.some(r => r.status !== 200)) wrong.push(`batch saves answered ${batches.map(r => r.status).join(',')}`);
  if (batchRows.length !== 1) wrong.push(`batch saves left ${batchRows.length} active rows ${JSON.stringify(batchRows.map(r => r.price))}`);

  // c) the audit row of each change is written with the price, an unchanged save writes neither
  const audits = await orm.select({ id: activityLogs.id }).from(activityLogs)
    .where(and(eq(activityLogs.entity, 'قیمت کالا'), eq(activityLogs.entityId, String(first))));
  if (audits.length !== 5) wrong.push(`single saves wrote ${audits.length} audit rows, expected 5`);
  const [kept] = singleRows;
  const again = await ctx.post(`/api/items/${first}/prices`, { title: 'عمده', price: kept ? kept.price.toNumber() : 0 });
  const afterAgain = await activeRows(first);
  if (again.status !== 200 || afterAgain.length !== 1 || afterAgain[0].id !== kept?.id || again.body?.id !== kept?.id) {
    wrong.push(`an unchanged save answered ${again.status} id ${again.body?.id} and left ${JSON.stringify(afterAgain.map(r => r.id))} (kept ${kept?.id})`);
  }

  // d) duplicates written before this version are listed by the financial health check, never removed
  const { findDuplicateActivePrices, buildDuplicateActivePriceHealthTest } = await import('../../services/items/itemPriceIntegrity.js');
  const [legacy] = await orm.insert(itemPrices).values({ itemId: second, title: 'فروشگاه', price: money(1), currency: 'IRR', isDeleted: 0 }).returning({ id: itemPrices.id });
  const health = buildDuplicateActivePriceHealthTest(await findDuplicateActivePrices());
  const listed = health.items?.find(i => i.id === second);
  if (health.status !== 'warning' || !listed) wrong.push(`health check ${health.status} did not list item ${second}`);
  if ((await activeRows(second)).length !== 2) wrong.push('the health check changed the duplicate rows');
  const healed = await ctx.post('/api/items/prices/batch-update', { updates: [{ itemId: second, title: 'فروشگاه', price: 750000 }] });
  const afterHeal = await activeRows(second);
  if (healed.status !== 200 || afterHeal.length !== 1 || afterHeal.some(r => r.id === legacy.id)) wrong.push(`the next save left ${JSON.stringify(afterHeal)}`);

  if (wrong.length > 0) throw new Error(wrong.join(' | '));
  return `single saves 5 × 200 → 1 active; batch saves 5 × 200 → 1 active; 5 audit rows; unchanged save keeps row ${kept?.id}; legacy duplicate listed and replaced by the next save`;
}

async function activePrice(itemId: number, title: string) {
  const [row] = await orm.select({ price: itemPrices.price, currency: itemPrices.currency }).from(itemPrices)
    .where(and(eq(itemPrices.itemId, itemId), eq(itemPrices.title, title), eq(itemPrices.isDeleted, 0)));
  return row ? `${row.price.toString()} ${row.currency}` : 'none';
}

async function amountCurrencyCase(ctx: Ctx): Promise<string> {
  const wrong: string[] = [];
  const id = await newItem(ctx, '3');
  const seed = await ctx.post(`/api/items/${id}/prices`, { title: 'عمده', price: 900000 });
  if (seed.status !== 200) throw new Error(`seed price ${seed.status} ${JSON.stringify(seed.body)}`);

  // a) single save: negative, zero, text and unknown currencies are 400 and change nothing
  const bad: Array<[string, Record<string, unknown>]> = [
    ['negative', { price: -500000 }], ['zero', { price: 0 }], ['text', { price: 'abc' }], ['empty', { price: '' }],
    ['XYZ', { price: 1000, currency: 'XYZ' }], ['toman', { price: 1000, currency: 'تومان' }],
  ];
  for (const [label, body] of bad) {
    const res = await ctx.post(`/api/items/${id}/prices`, { title: 'عمده', ...body });
    if (res.status !== 400) wrong.push(`single ${label} answered ${res.status}`);
  }
  if (await activePrice(id, 'عمده') !== '900000 IRR') wrong.push(`invalid single saves changed the price to ${await activePrice(id, 'عمده')}`);
  const persian = await ctx.post(`/api/items/${id}/prices`, { title: 'عمده', price: '۲٬۵۰۰٬۰۰۰', currency: 'usd' });
  if (persian.status !== 200 || await activePrice(id, 'عمده') !== '2500000 USD') wrong.push(`Persian digits / lower-case currency answered ${persian.status} and stored ${await activePrice(id, 'عمده')}`);

  // b) batch: zero, null and text are 400 for the whole batch; only remove: true deletes
  for (const [label, update] of [['zero', { price: 0 }], ['null', { price: null }], ['text', { price: 'abc' }], ['XYZ', { price: 5, currency: 'XYZ' }]] as const) {
    const res = await ctx.post('/api/items/prices/batch-update', { updates: [{ itemId: id, title: 'فروشگاه', price: 400000 }, { itemId: id, title: 'عمده', ...update }] });
    if (res.status !== 400) wrong.push(`batch ${label} answered ${res.status}`);
  }
  if (await activePrice(id, 'عمده') !== '2500000 USD' || await activePrice(id, 'فروشگاه') !== 'none') wrong.push('a refused batch changed prices');
  const removed = await ctx.post('/api/items/prices/batch-update', { updates: [{ itemId: id, title: 'عمده', remove: true }] });
  if (removed.status !== 200 || await activePrice(id, 'عمده') !== 'none') wrong.push(`remove: true answered ${removed.status} and left ${await activePrice(id, 'عمده')}`);

  // c) Excel import: an invalid price or currency refuses the whole row before anything is written
  const [item] = await orm.select({ code: items.code, name: items.name, unit: items.unit }).from(items).where(eq(items.id, id));
  const rows = [
    { 'کد کالا': item.code, 'نام محصول': item.name, 'واحد': 'جفت', 'قیمت عمده': 0 },
    { 'کد کالا': item.code, 'نام محصول': item.name, 'واحد': 'جفت', 'قیمت عمده': 'abc' },
    { 'کد کالا': item.code, 'نام محصول': item.name, 'واحد': 'جفت', 'قیمت عمده': 1000, 'واحد ارز': 'XYZ' },
  ];
  for (const row of rows) {
    const res = await ctx.post('/api/items/unified-import', { rows: [row] });
    const errors = ((res.body?.errors ?? []) as Array<{ message: string }>).map(e => e.message).join(' | ');
    if (!errors.includes('این ردیف ثبت نشد')) wrong.push(`Excel ${JSON.stringify(row['قیمت عمده'])} ${row['واحد ارز'] ?? ''} gave no row error: ${res.status} ${errors}`);
  }
  const [afterRefused] = await orm.select({ unit: items.unit }).from(items).where(eq(items.id, id));
  if (afterRefused.unit !== item.unit || await activePrice(id, 'عمده') !== 'none') wrong.push(`a refused Excel row wrote unit ${afterRefused.unit} / price ${await activePrice(id, 'عمده')}`);
  const okRow = await ctx.post('/api/items/unified-import', { rows: [{ 'کد کالا': item.code, 'نام محصول': item.name, 'قیمت عمده': '۲٬۵۰۰٬۰۰۰' }] });
  if (await activePrice(id, 'عمده') !== '2500000 IRR') wrong.push(`Excel Persian digits stored ${await activePrice(id, 'عمده')} (${okRow.status})`);

  // d) rows written before this version are listed by the health check and not changed
  const { findInvalidActivePrices, buildInvalidActivePriceHealthTest } = await import('../../services/items/itemPriceIntegrity.js');
  const legacy = await orm.insert(itemPrices).values([
    { itemId: id, title: 'فروشگاه', price: money(-1), currency: 'IRR', isDeleted: 0 },
    { itemId: id, title: 'مصرف‌کننده', price: money(1000), currency: 'XYZ', isDeleted: 0 },
  ]).returning({ id: itemPrices.id });
  const health = buildInvalidActivePriceHealthTest(await findInvalidActivePrices());
  const listed = legacy.filter(l => health.items?.some(i => i.id === l.id)).length;
  if (health.status !== 'warning' || listed !== 2) wrong.push(`health check ${health.status} listed ${listed} of 2 legacy rows`);
  if ((await activeRows(id)).length !== 3) wrong.push('the health check changed price rows');
  await orm.update(itemPrices).set({ isDeleted: 1 }).where(inArray(itemPrices.id, legacy.map(l => l.id)));

  if (wrong.length > 0) throw new Error(wrong.join(' | '));
  return 'invalid amounts and currencies 400; Persian digits and lower-case currency stored; batch removal only with remove: true; invalid Excel prices refuse the row; legacy rows listed';
}
