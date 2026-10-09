import request from 'supertest';
import { TestCaseResult, makeTestCase } from '../types.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * v10.0.35 (series 10 phase 3, L5 E7, part of TD-960): `POST /setup` wrote the first admin, the default warehouse and
 * each company setting one by one on the pool, so a failed settings write left the admin behind and the setup could not
 * be run again («راه‌اندازی قبلاً انجام شده»). Runs in its own isolated schema without users: a trigger refuses the
 * company logo setting, the setup must answer an error and leave no user; after the trigger is dropped the setup runs
 * and writes its audit row. On v10.0.25 the admin stays after the failed setup.
 */
export async function runInitialSetupTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_initial_setup_one_transaction_td_960';
  if (!shouldRun(id, 'td960', 'setup', 'e7', 'package2')) return [];
  const name = 'v10.0.35: the initial setup writes the admin, warehouse and settings in one transaction (TD-960)';
  const tStart = Date.now();
  const { pool } = await import('../../db/drizzle.js');
  let inner: { schema: string; teardown: () => Promise<void> } | null = null;
  try {
    const { setupTestSchema } = await import('../setup/testDb.js');
    const { getTestApp } = await import('../fixtures/httpTestHelper.js');
    inner = await setupTestSchema();
    const s = inner.schema;
    const current = (await pool.query('SELECT current_schema() AS s')).rows[0]?.s;
    if (current !== s) throw new Error(`isolated schema not active (${current} instead of ${s}); setup not run`);
    const app = await getTestApp();
    const userCount = async () => Number((await pool.query(`SELECT count(*)::int AS n FROM "${s}".users`)).rows[0]?.n ?? -1);
    if (await userCount() !== 0) throw new Error('the isolated schema already holds users');
    const warehouseCount = async () => Number((await pool.query(`SELECT count(*)::int AS n FROM "${s}".warehouses`)).rows[0]?.n ?? -1);
    const warehousesBefore = await warehouseCount();

    await pool.query(`CREATE FUNCTION "${s}".td960_refuse_logo() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.key = 'company_logo' THEN RAISE EXCEPTION 'td960 refused setting'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER td960_refuse_logo BEFORE INSERT OR UPDATE ON "${s}".app_settings
      FOR EACH ROW EXECUTE FUNCTION "${s}".td960_refuse_logo()`);

    const token = (process.env.ERP_SETUP_TOKEN || 'papital_erp_setup_token_2026').trim();
    const body = { username: 'td960_owner', password: 'abcd12345678', fullName: 'مدیر آزمون', companyName: 'کارگاه آزمون' };
    const wrong: string[] = [];
    const failed = await request(app).post('/api/setup').set('x-setup-token', token).send(body);
    if (failed.status < 400) wrong.push(`setup with a refused setting answered ${failed.status}`);
    const left = await userCount();
    if (left !== 0) wrong.push(`users left after the failed setup: ${left}`);
    const warehousesAfter = await warehouseCount();
    if (warehousesAfter !== warehousesBefore) wrong.push(`warehouses ${warehousesBefore} before and ${warehousesAfter} after the failed setup`);

    await pool.query(`DROP TRIGGER td960_refuse_logo ON "${s}".app_settings`);
    const ok = await request(app).post('/api/setup').set('x-setup-token', token).send(body);
    if (ok.status !== 200) wrong.push(`setup after the failure answered ${ok.status} ${JSON.stringify(ok.body).slice(0, 160)}`);
    const audit = Number((await pool.query(
      `SELECT count(*)::int AS n FROM "${s}".activity_logs WHERE entity = 'کاربران سیستم' AND action = 'CREATE' AND username = 'td960_owner'`,
    )).rows[0]?.n);
    if (ok.status === 200 && audit !== 1) wrong.push(`setup audit rows: ${audit}, not 1`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `failed setup answered ${failed.status} and left no user and no new warehouse; the retried setup created the admin with one audit row`,
    })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
  } finally {
    if (inner) await inner.teardown();
    const { invalidateRoleCache, invalidateSettingsCache } = await import('../../lib/memoryCache.js');
    const { invalidateUserAuthCache } = await import('../../middleware/auth.js');
    const { invalidateTimezoneCache } = await import('../../lib/businessClock.js');
    invalidateRoleCache();
    invalidateSettingsCache();
    invalidateUserAuthCache();
    invalidateTimezoneCache();
  }
}
