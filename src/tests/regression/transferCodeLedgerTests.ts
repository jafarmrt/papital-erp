import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, transfers } from '../../db/schema.js';
import { createTestItem } from '../fixtures/factories.js';

/**
 * Phase 3 lane L2, package 6 ledger (OBS-R1-82): GET /transfers answers one page of transfer codes with only that
 * page's products and a summary of every code, searching code, title, notes and the linked products' names and codes in
 * SQL. On v10.0.25 it read every design and every product, had no page cap and no summary.
 */
export async function runTransferCodeLedgerTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_transfer_codes_paged_obs_r1_82';
  if (!shouldRun(id, 'obs-r1-82', 'transfers', 'package6')) return results;

  const name = 'v10.0.26: transfer codes are paged in SQL with only the page products and a summary (OBS-R1-82)';
  const tStart = Date.now();
  const tag = `Q${Date.now() % 1_000_000_000}`;
  const codeA = `${tag}A`;
  const codeB = `${tag}B`;
  const codeC = `${tag}C`;
  const productWord = `nilufar${tag.toLowerCase()}`;
  const itemIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const get = (url: string) => request(app).get(url).set('Cookie', admin.cookie);

    for (const [code, itemName] of [
      [`1404-T-${codeA}-01`, `${tag} a1`],
      [`1404-T-${codeA}-02`, `${tag} a2`],
      [`1404-T-${codeB}-01`, `${productWord} b1`],
    ] as const) {
      const item = await createTestItem({ type: 'product', code, name: itemName, stocks: {} });
      itemIds.push(item.id);
    }
    await orm.insert(transfers).values({ code: codeC, title: `${tag} design`, image: '/uploads/td-r1-82.png', isDeleted: 0 });

    const wrong: string[] = [];
    const first = await get(`/api/transfers?search=${tag}&limit=2&page=1`);
    const firstCodes = (first.body?.data ?? []).map((r: { code: string }) => r.code);
    if (first.status !== 200 || first.body?.total !== 3 || firstCodes.join(',') !== `${codeA},${codeB}`) {
      wrong.push(`first page: ${first.status} total ${first.body?.total} codes ${firstCodes.join(',')}`);
    }
    const aProducts = (first.body?.data?.[0]?.products ?? []).map((p: { code: string }) => p.code).sort();
    if (aProducts.join(',') !== `1404-T-${codeA}-01,1404-T-${codeA}-02`) wrong.push(`products of ${codeA}: ${aProducts.join(',')}`);
    if (!first.body?.summary || first.body.summary.totalCodes < 3 || first.body.summary.withImage < 1 || first.body.summary.linkedProducts < 3) {
      wrong.push(`summary ${JSON.stringify(first.body?.summary)}`);
    }

    const second = await get(`/api/transfers?search=${tag}&limit=2&page=2`);
    const c = second.body?.data?.[0];
    if (second.body?.data?.length !== 1 || c?.code !== codeC || c?.products?.length !== 0 || c?.title !== `${tag} design`) {
      wrong.push(`second page ${JSON.stringify(second.body?.data)}`);
    }

    const withImage = await get(`/api/transfers?search=${tag}&image=with_image`);
    if (withImage.body?.total !== 1 || withImage.body?.data?.[0]?.code !== codeC) wrong.push(`with_image total ${withImage.body?.total}`);

    const byProduct = await get(`/api/transfers?search=${productWord}`);
    if (byProduct.body?.total !== 1 || byProduct.body?.data?.[0]?.code !== codeB) wrong.push(`search by product name total ${byProduct.body?.total}`);

    const tooMany = await get('/api/transfers?limit=500');
    if (tooMany.status !== 400) wrong.push(`limit=500 answered ${tooMany.status}`);

    const single = await get(`/api/transfers/${codeA}`);
    if (single.status !== 200 || single.body?.data?.productCount !== 2) wrong.push(`single code ${single.status} ${single.body?.data?.productCount}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'one page of codes with its own products, summary of every code, image and product-name filters in SQL, limit capped',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.delete(transfers).where(inArray(transfers.code, [codeA, codeB, codeC])).catch(() => undefined);
    if (itemIds.length > 0) await orm.delete(items).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
