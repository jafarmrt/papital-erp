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
