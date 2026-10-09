import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings, itemPrices, items } from '../../db/schema.js';
import { money } from '../../lib/money.js';

/**
 * Phase 3 lane L2, package 5 ledger part 2 (TD-987). OBS-R1-74: the item list sorts, counts the low-stock card and
 * searches the category on the server over every filtered item (v10.0.31 sorted and counted only the current page and
 * searched name and code only). OBS-R1-79: the pricing page reads one page of items with their prices and the price
 * lists from `GET /items/pricing-page`, filtered by price completeness on the server (the route did not exist).
 */
const SETTING = 'pricing_strategies';

async function seedItems(token: string) {
  const rows = await orm.insert(items).values([
    { type: 'product', name: `${token} الف`, code: `${token}-A`, unit: 'عدد', category: `${token}-cat`, reorderPoint: 5 },
    { type: 'product', name: `${token} ب`, code: `${token}-B`, unit: 'عدد', category: 'گردنبند', reorderPoint: 0 },
    { type: 'product', name: `${token} ج`, code: `${token}-C`, unit: 'عدد', category: 'گردنبند', reorderPoint: 3 },
  ]).returning({ id: items.id, code: items.code });
  return Object.fromEntries(rows.map(r => [r.code.slice(-1), r.id])) as Record<'A' | 'B' | 'C', number>;
}

async function dropItems(ids: number[]) {
  if (ids.length === 0) return;
  await orm.update(itemPrices).set({ isDeleted: 1 }).where(inArray(itemPrices.itemId, ids));
  await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, ids));
}

export async function runItemListLedgerTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const idList = 'reg_items_list_server_sort_obs_r1_74';
  if (shouldRun(idList, 'obs-r1-74', 'items', 'package5')) {
    const name = 'v10.0.32: the item list sorts, counts low stock and searches the category on the server (OBS-R1-74)';
    const tStart = Date.now();
    const token = `RL74${Date.now().toString(36).toUpperCase()}`;
    let ids: number[] = [];
    try {
      const seeded = await seedItems(token);
      ids = Object.values(seeded);
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const admin = await getAdminSession();
      const get = (q: string) => request(app).get(`/api/items?type=product&${q}`).set('Cookie', admin.cookie);
      const wrong: string[] = [];
      const sorted = await get(`search=${encodeURIComponent(token)}&sort=code&direction=desc&page=1&limit=1`);
      if (sorted.status !== 200) wrong.push(`list ${sorted.status}`);
      if (sorted.body?.data?.[0]?.id !== seeded.C) wrong.push(`first of code desc is ${sorted.body?.data?.[0]?.code}, expected ${token}-C`);
      if (sorted.body?.stats?.lowStock !== 2) wrong.push(`lowStock ${JSON.stringify(sorted.body?.stats)} on a one-row page, expected 2`);
      const asc = await get(`search=${encodeURIComponent(token)}&sort=code&direction=asc&page=2&limit=1`);
      if (asc.body?.data?.[0]?.id !== seeded.B) wrong.push(`page 2 of code asc is ${asc.body?.data?.[0]?.code}, expected ${token}-B`);
      const byCategory = await get(`search=${encodeURIComponent(`${token}-cat`)}`);
      const found = (byCategory.body?.data ?? []).map((r: { id: number }) => r.id);
      if (found.length !== 1 || found[0] !== seeded.A) wrong.push(`category search found ${JSON.stringify(found)}`);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id: idList, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: 'server sort across pages, lowStock over the filter, category search' }));
    } catch (err) {
      results.push(makeTestCase({ id: idList, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      await dropItems(ids);
    }
  }

  const idPricing = 'reg_pricing_page_server_obs_r1_79';
  if (shouldRun(idPricing, 'obs-r1-79', 'pricing', 'package5')) {
    const name = 'v10.0.33: the pricing page reads one page of items with their prices from the server (OBS-R1-79)';
    const tStart = Date.now();
    const token = `RP79${Date.now().toString(36).toUpperCase()}`;
    let ids: number[] = [];
    const [previous] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SETTING));
    try {
      const lists = JSON.stringify(['عمده', 'فروشگاه']);
      await orm.insert(appSettings).values({ key: SETTING, value: lists }).onConflictDoUpdate({ target: appSettings.key, set: { value: lists } });
      const seeded = await seedItems(token);
      ids = Object.values(seeded);
      await orm.insert(itemPrices).values([
        { itemId: seeded.A, title: 'عمده', price: money('1000'), currency: 'IRR' },
        { itemId: seeded.A, title: 'فروشگاه', price: money('1200'), currency: 'IRR' },
        { itemId: seeded.B, title: 'عمده', price: money('900'), currency: 'IRR' },
      ]);
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const admin = await getAdminSession();
      const get = (q: string) => request(app).get(`/api/items/pricing-page?type=product&search=${encodeURIComponent(token)}&${q}`).set('Cookie', admin.cookie);
      const wrong: string[] = [];
      const page = await get('page=1&limit=2');
      if (page.status !== 200) wrong.push(`page ${page.status} ${JSON.stringify(page.body).slice(0, 160)}`);
      if (page.body?.total !== 3 || page.body?.data?.length !== 2 || page.body?.totalPages !== 2) wrong.push(`paging total=${page.body?.total} rows=${page.body?.data?.length}`);
      if ((page.body?.strategies ?? []).join('|') !== 'عمده|فروشگاه') wrong.push(`strategies ${JSON.stringify(page.body?.strategies)}`);
      const pageIds = new Set((page.body?.data ?? []).map((r: { id: number }) => String(r.id)));
      if (Object.keys(page.body?.prices ?? {}).some(id => !pageIds.has(id))) wrong.push('prices of items outside the page');
      const complete = await get('priceFilter=has_price');
      if (complete.body?.total !== 1 || complete.body?.data?.[0]?.id !== seeded.A) wrong.push(`has_price ${JSON.stringify(complete.body?.data?.map((r: { id: number }) => r.id))}`);
      const missing = await get('priceFilter=missing_price');
      if (missing.body?.total !== 2) wrong.push(`missing_price total ${missing.body?.total}`);
      const badLimit = await get('limit=5000');
      if (badLimit.status !== 400) wrong.push(`limit 5000 -> ${badLimit.status}`);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id: idPricing, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: 'one page with its prices and lists, price completeness filtered on the server' }));
    } catch (err) {
      results.push(makeTestCase({ id: idPricing, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      await dropItems(ids);
      if (previous) await orm.update(appSettings).set({ value: previous.value }).where(eq(appSettings.key, SETTING));
      else await orm.delete(appSettings).where(eq(appSettings.key, SETTING));
    }
  }

  return results;
}
