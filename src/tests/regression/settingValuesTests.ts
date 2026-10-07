import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';

/**
 * Package 16, TD-672 / B16-08 (decision t4) and TD-667 / B16-03 (decision t1): business settings are checked on save.
 * On v9.0.230 `fast_moving_days` = "" or "abc" was saved with 200 and `/dashboard-bi-stats` then answered 500 for every
 * user; "-30" was saved too, and `currency` took any text. Movement days are integers 1..3650 with fast < slow < dead,
 * `currency` is IRR or TOMAN, and the dashboard falls back to the defaults when a stored value is invalid.
 */
const KEYS = ['fast_moving_days', 'slow_moving_days', 'dead_stock_days', 'currency'];

export async function runSettingValuesTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_setting_values_validated_td_672';
  if (!shouldRun(id, 'td672', 'td667', 'settings', 'dashboard', 'package16')) return results;

  const name = 'v9.0.250: settings refuse invalid movement days and currency, the dashboard falls back to defaults (TD-672, TD-667)';
  const tStart = Date.now();
  const saved = await orm.select().from(appSettings).where(inArray(appSettings.key, KEYS));
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { invalidateDashboardBiCache } = await import('../../routes/dashboard.routes.js');
    const { invalidateSettingsCache } = await import('../../lib/memoryCache.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const save = (settings: Array<{ key: string; value: string }>) => request(app).post('/api/settings')
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({ settings });
    const violations: string[] = [];

    await orm.delete(appSettings).where(inArray(appSettings.key, KEYS));
    await orm.insert(appSettings).values([
      { key: 'fast_moving_days', value: '30' }, { key: 'slow_moving_days', value: '90' },
      { key: 'dead_stock_days', value: '180' }, { key: 'currency', value: 'IRR' },
    ]);
    invalidateSettingsCache();

    const refused: Array<[string, Array<{ key: string; value: string }>]> = [
      ['empty fast days', [{ key: 'fast_moving_days', value: '' }]],
      ['text fast days', [{ key: 'fast_moving_days', value: 'abc' }]],
      ['negative fast days', [{ key: 'fast_moving_days', value: '-30' }]],
      ['fractional slow days', [{ key: 'slow_moving_days', value: '90.5' }]],
      ['dead days above 3650', [{ key: 'dead_stock_days', value: '4000' }]],
      ['fast days not below slow days', [{ key: 'fast_moving_days', value: '120' }]],
      ['currency USD', [{ key: 'currency', value: 'USD' }]],
      ['free-text currency', [{ key: 'currency', value: 'ریال؟' }]],
    ];
    for (const [label, settings] of refused) {
      const res = await save(settings);
      if (res.status !== 422) violations.push(`${label}: HTTP ${res.status}, expected 422`);
    }
    const unchanged = await orm.select().from(appSettings).where(inArray(appSettings.key, KEYS));
    const stored = Object.fromEntries(unchanged.map(r => [r.key, r.value]));
    if (stored.fast_moving_days !== '30' || stored.currency !== 'IRR') {
      violations.push(`a refused save changed the stored values: ${JSON.stringify(stored)}`);
    }

    const ok = await save([
      { key: 'fast_moving_days', value: '۴۵' }, { key: 'slow_moving_days', value: '100' }, { key: 'currency', value: 'TOMAN' },
    ]);
    if (ok.status !== 200) violations.push(`valid save: HTTP ${ok.status} ${JSON.stringify(ok.body).slice(0, 160)}`);
    const [fast] = await orm.select().from(appSettings).where(inArray(appSettings.key, ['fast_moving_days']));
    if (fast?.value !== '45') violations.push(`Persian digits are stored as Latin: got ${fast?.value}`);

    // A value stored before this release (written directly) must not break the dashboard
    await orm.update(appSettings).set({ value: 'abc' }).where(inArray(appSettings.key, ['fast_moving_days']));
    invalidateSettingsCache();
    invalidateDashboardBiCache();
    const bi = await request(app).get('/api/dashboard-bi-stats').set('Cookie', admin.cookie);
    if (bi.status !== 200) violations.push(`dashboard with a stored invalid value: HTTP ${bi.status}`);
    else if (bi.body?.fastDays !== 30 || bi.body?.slowDays !== 90 || bi.body?.deadDays !== 180) {
      violations.push(`dashboard did not fall back to the defaults: ${bi.body?.fastDays}/${bi.body?.slowDays}/${bi.body?.deadDays}`);
    }

    if (violations.length > 0) throw new Error(violations.join(' | '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `${refused.length} invalid saves refused, valid save stored, dashboard fell back to 30/90/180`,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.delete(appSettings).where(inArray(appSettings.key, KEYS)).catch(() => undefined);
    if (saved.length > 0) await orm.insert(appSettings).values(saved.map(r => ({ key: r.key, value: r.value }))).catch(() => undefined);
    const { invalidateSettingsCache } = await import('../../lib/memoryCache.js');
    invalidateSettingsCache();
    const { invalidateDashboardBiCache } = await import('../../routes/dashboard.routes.js');
    invalidateDashboardBiCache();
  }
  return results;
}
