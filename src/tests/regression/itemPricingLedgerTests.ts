import request from 'supertest';
import { eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import { ItemPricingService } from '../../services/items/itemPricing.service.js';

/**
 * Phase 3 lane L2, package 5 ledger (TD-987). OBS-R1-71: price lists are stored as a JSON array, so a title with a
 * comma stays one list; a comma-joined value is refused on save (v10.0.21 split it into two lists). OBS-R1-72: an
 * unreadable stored value is an error, never the default lists (v10.0.21 swallowed it and returned the defaults).
 */
const KEY = 'pricing_strategies';
const COMMA_TITLE = 'فروش ویژه، نمایشگاه, پاییز';

async function storedValue(): Promise<string | null> {
  const [row] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY));
  return row ? row.value : null;
}

async function restore(previous: string | null): Promise<void> {
  if (previous === null) await orm.delete(appSettings).where(eq(appSettings.key, KEY));
  else await orm.insert(appSettings).values({ key: KEY, value: previous }).onConflictDoUpdate({ target: appSettings.key, set: { value: previous } });
}

export async function runItemPricingLedgerTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const idJson = 'reg_price_lists_json_obs_r1_71';
  if (shouldRun(idJson, 'obs-r1-71', 'pricing', 'package5')) {
    const name = 'v10.0.27: price lists are saved as a JSON array and a comma-joined value is refused (OBS-R1-71)';
    const tStart = Date.now();
    const previous = await storedValue();
    try {
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const admin = await getAdminSession();
      const save = (value: string) => request(app).post('/api/settings')
        .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
        .send({ settings: [{ key: KEY, value }] });
      const wrong: string[] = [];
      const comma = await save('فروشگاه,عمده');
      if (comma.status !== 422 || comma.body?.code !== 'SETTING_PRICING_STRATEGIES_INVALID') wrong.push(`comma value: ${comma.status} ${comma.body?.code}`);
      const duplicate = await save(JSON.stringify(['عمده', ' عمده ']));
      if (duplicate.status !== 422) wrong.push(`duplicate titles: ${duplicate.status}`);
      const ok = await save(JSON.stringify([COMMA_TITLE, 'عمده']));
      if (ok.status !== 200) wrong.push(`JSON value: ${ok.status} ${JSON.stringify(ok.body).slice(0, 160)}`);
      const titles = await ItemPricingService.getPricingStrategies();
      if (titles.length !== 2 || titles[0] !== COMMA_TITLE) wrong.push(`read back ${JSON.stringify(titles)}`);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id: idJson, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: 'comma value 422, JSON array kept a title with a comma' }));
    } catch (err) {
      results.push(makeTestCase({ id: idJson, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      await restore(previous);
    }
  }

  const idRead = 'reg_price_lists_read_error_obs_r1_72';
  if (shouldRun(idRead, 'obs-r1-72', 'pricing', 'package5')) {
    const name = 'v10.0.28: an unreadable price list setting is an error, never the default lists (OBS-R1-72)';
    const tStart = Date.now();
    const previous = await storedValue();
    try {
      await restore('["فروشگاه", "عمده"');
      let outcome = '';
      try {
        outcome = `returned ${JSON.stringify(await ItemPricingService.getPricingStrategies())}`;
      } catch (err) {
        outcome = (err as { code?: string }).code ?? String(err);
      }
      if (outcome !== 'PRICING_STRATEGIES_UNREADABLE') throw new Error(`expected PRICING_STRATEGIES_UNREADABLE, got ${outcome}`);
      await restore('فروشگاه,عمده');
      const legacy = await ItemPricingService.getPricingStrategies();
      if (legacy.join('|') !== 'فروشگاه|عمده') throw new Error(`legacy comma value read as ${JSON.stringify(legacy)}`);
      results.push(makeTestCase({ id: idRead, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details: 'malformed JSON -> 409 PRICING_STRATEGIES_UNREADABLE; legacy comma value still read' }));
    } catch (err) {
      results.push(makeTestCase({ id: idRead, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      await restore(previous);
    }
  }
  return results;
}
