import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';

/**
 * Package 15 (events and integrations), TD-723 / B15-21: the WooCommerce «test connection» route takes a missing or masked
 * key from the stored settings, and then only at the stored store address. On v9.0.321 the route required both keys in the
 * body, so a non-admin (who sees «********») always tested the mask, and nothing stopped stored keys from being sent to an
 * address the caller chose once a fallback existed. Only refusals are exercised here, so no request leaves the test.
 */
export async function runWooConnectionTestTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_woocommerce_test_connection_stored_keys_td_723';
  if (!shouldRun(id, 'td723', 'b15-21', 'woocommerce', 'package15')) return results;

  const name = 'v9.0.315: WooCommerce test connection uses the stored keys only at the stored address and refuses incomplete settings (TD-723)';
  const tStart = Date.now();
  const keys = ['wc_store_url', 'wc_consumer_key', 'wc_consumer_secret'];
  const saved = await orm.select().from(appSettings).where(inArray(appSettings.key, keys));
  const put = async (values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) {
      await orm.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
    }
  };
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const post = (body: Record<string, unknown>) => request(app).post('/api/woocommerce/test-connection')
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const wrong: string[] = [];

    await put({ wc_store_url: 'https://shop.example.org', wc_consumer_key: 'ck_td723_stored', wc_consumer_secret: 'cs_td723_stored' });
    for (const body of [
      { url: 'https://attacker.example' },
      { url: 'https://attacker.example', consumerKey: 'ck_typed', consumerSecret: '********' },
    ]) {
      const res = await post(body);
      if (res.status !== 422 || res.body?.code !== 'WC_TEST_STORED_KEYS_OTHER_URL') {
        wrong.push(`stored keys at another address ${JSON.stringify(body)}: ${res.status} ${res.body?.code ?? ''}`);
      }
    }

    await put({ wc_consumer_key: '', wc_consumer_secret: '' });
    const incomplete = await post({ consumerKey: '********', consumerSecret: '********' });
    if (incomplete.status !== 422 || incomplete.body?.code !== 'WC_TEST_SETTINGS_INCOMPLETE') {
      wrong.push(`incomplete settings: ${incomplete.status} ${incomplete.body?.code ?? ''}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'stored keys with another address -> 422 WC_TEST_STORED_KEYS_OTHER_URL; masked keys with no stored keys -> 422 WC_TEST_SETTINGS_INCOMPLETE',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.delete(appSettings).where(inArray(appSettings.key, keys));
    for (const row of saved) await orm.insert(appSettings).values(row);
  }
  return results;
}
