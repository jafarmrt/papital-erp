import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers, items } from '../../db/schema.js';

/**
 * Package 16 (dashboard and shell), TD-675 / B16-11: global search puts the exact name first, then names that start
 * with the text, then the rest, and folds Arabic «ي» / «ك» and Persian digits on both sides. On v9.0.290 five parties
 * «<name> …» hid the party «<name>» itself, an Arabic «كيان» found no «کیان», and a Persian «یاقوت» found no item
 * stored with an Arabic «ياقوت».
 */
export async function runGlobalSearchRankTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_global_search_rank_fold_td_675';
  if (!shouldRun(id, 'td675', 'b16-11', 'search', 'package16')) return results;

  const name = 'v9.0.286: global search ranks the exact name first and folds Arabic letters and Persian digits (TD-675)';
  const tStart = Date.now();
  const customerIds: number[] = [];
  const itemIds: number[] = [];
  try {
    const { createTestCustomer, createTestItem } = await import('../fixtures/factories.js');
    const { GlobalSearchService } = await import('../../services/system/globalSearch.service.js');
    const tag = String(Date.now()).slice(-7);
    const toPersian = (s: string) => s.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

    const base = `علی${tag}`;
    // a name that only contains the text, recorded first: it ranks after every name that starts with the text
    customerIds.push((await createTestCustomer({ name: `شرکت ${base}` })).id);
    for (const last of ['کاظمی', 'رضایی', 'احمدی', 'محمدی', 'کریمی', 'حسینی']) {
      customerIds.push((await createTestCustomer({ name: `${base} ${last}` })).id);
    }
    customerIds.push((await createTestCustomer({ name: base })).id);
    customerIds.push((await createTestCustomer({ name: `شرکت کیان${tag}` })).id);
    itemIds.push((await createTestItem({ type: 'product', name: `انگشتر ياقوت${tag}`, stocks: {} })).id);

    const scope = { items: true, customers: true, documents: false, projects: false };
    const exact = await GlobalSearchService.search(base, scope);
    const arabic = await GlobalSearchService.search(`كيان${toPersian(tag)}`, scope);
    const persian = await GlobalSearchService.search(`یاقوت${tag}`, scope);

    const wrong: string[] = [];
    if (exact.customers[0]?.name !== base) wrong.push(`search «${base}» listed first «${exact.customers[0]?.name ?? 'nothing'}», expected the exact name`);
    if (exact.customers.some(c => c.name === `شرکت ${base}`)) wrong.push('a name that only contains the text came before names that start with it');
    if (!arabic.customers.some(c => c.name === `شرکت کیان${tag}`)) wrong.push('an Arabic «كيان» with Persian digits found no «کیان»');
    if (!persian.items.some(i => i.id === itemIds[0])) wrong.push('a Persian «یاقوت» found no item stored with an Arabic «ياقوت»');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'exact name first; Arabic letters and Persian digits folded on both sides',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
