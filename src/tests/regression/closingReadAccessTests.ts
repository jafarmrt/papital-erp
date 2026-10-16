import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings, roles, users } from '../../db/schema.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';

/**
 * Closing sweep, decision ت۴۰ items 1 and 3:
 * - OBS-R2-60: an item, transfer or profile image under `/uploads` needs a session; only the public asset folders and
 *   a legacy company logo file stay open. Red on v10.1.57, which served every image file to anyone.
 * - OBS-R2-96: `GET /settings` gives a reader without `settings.manage` only the shared settings, and a WooCommerce
 *   reader also the shop connection (keys masked). Red on v10.1.57, which gave every signed-in user every setting.
 */
/** test data: a company name to store when the database has none */
const TEST_COMPANY_NAME = 'شرکت آزمون';

type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Row = { key: string; value: string };

export async function runClosingReadAccessTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const imagesId = 'reg_upload_images_need_session_obs_r2_60';
  if (shouldRun(imagesId, 'obs_r2_60', 'uploads', 'images', 'security')) {
    const tStart = Date.now();
    const dir = path.join(process.cwd(), 'public', 'uploads');
    const stamp = String(Date.now());
    const files = [`image-${stamp}.jpg`, `thumbnail-${stamp}.png`, `${stamp}-avatar.webp`, `logo-${stamp}.png`];
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of files) fs.writeFileSync(path.join(dir, f), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const admin = await getAdminSession();
      const wrong: string[] = [];
      for (const f of files.slice(0, 3)) {
        const anonymous = await request(app).get(`/uploads/${f}`);
        if (anonymous.status !== 401) wrong.push(`${f} without a session answered ${anonymous.status}, expected 401`);
        const signedIn = await request(app).get(`/uploads/${f}`).set('Cookie', admin.cookie);
        if (signedIn.status !== 200) wrong.push(`${f} with a session answered ${signedIn.status}`);
      }
      const logo = await request(app).get(`/uploads/${files[3]}`);
      if (logo.status !== 200) wrong.push(`the legacy logo file without a session answered ${logo.status}`);
      const nested = await request(app).get(`/uploads/items/logo-${stamp}.png`);
      if (nested.status !== 401) wrong.push(`a logo-named image in a sub-folder without a session answered ${nested.status}`);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({
        id: imagesId, name: 'OBS-R2-60: an uploaded image needs a session; only the public folders and a legacy logo file are open',
        layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'item, thumbnail and profile images 401 without a session and 200 with one; logo-*.png at the root 200',
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: imagesId, name: 'OBS-R2-60: an uploaded image needs a session', layer: 'regression', executionType: 'real_database',
        passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      for (const f of files) fs.rmSync(path.join(dir, f), { force: true });
    }
  }

  const settingsId = 'reg_settings_read_scope_obs_r2_96';
  if (shouldRun(settingsId, 'obs_r2_96', 'settings', 'security')) {
    const tStart = Date.now();
    const roleIds: number[] = [];
    const userIds: number[] = [];
    const addedKeys: string[] = [];
    try {
      const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
      const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
      const app = await getTestApp();
      const admin = await getAdminSession();
      // one stored setting of each kind: shared, admin-only business, WooCommerce key
      for (const [key, value] of [['company_name', TEST_COMPANY_NAME], ['invoice_start_number', '1000'], ['wc_consumer_key', 'ck_obs_r2_96']] as const) {
        const [had] = await orm.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, key));
        if (!had) {
          await orm.insert(appSettings).values({ key, value });
          addedKeys.push(key);
        }
      }
      invalidateSettingsCache();
      const sessionWith = async (permissions: string[]) => {
        const role = await createTestRole({ permissions });
        roleIds.push(role.id);
        const user = await createTestUser({ role: role.code });
        userIds.push(user.id);
        return loginTestUserWithSession(app, user.username);
      };
      const read = async (cookie: string) => {
        const res = await request(app).get('/api/settings').set('Cookie', cookie);
        if (res.status !== 200) throw new Error(`GET /settings answered ${res.status}`);
        return new Map((res.body as Row[]).map(r => [r.key, r.value]));
      };
      const wrong: string[] = [];

      const plain = await read((await sessionWith(['documents.view'])).cookie);
      if (!plain.has('company_name')) wrong.push('a plain reader lost the company name');
      if (plain.has('invoice_start_number') || plain.has('wc_consumer_key')) wrong.push(`a plain reader got ${[...plain.keys()].filter(k => k === 'invoice_start_number' || k === 'wc_consumer_key').join(', ')}`);

      const shop = await read((await sessionWith(['woocommerce.view'])).cookie);
      if (shop.has('invoice_start_number')) wrong.push('a WooCommerce reader got the invoice start number');
      if (shop.get('wc_consumer_key') !== '********') wrong.push(`a WooCommerce reader got the consumer key as ${JSON.stringify(shop.get('wc_consumer_key'))}`);

      const manager = await read((await sessionWith(['settings.manage'])).cookie);
      if (!manager.has('invoice_start_number') || manager.get('wc_consumer_key') !== '********') wrong.push('a settings manager did not get every setting with the keys masked');

      const all = await read(admin.cookie);
      if (!all.has('invoice_start_number') || !all.has('wc_consumer_key')) wrong.push('the system admin did not get every setting');

      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({
        id: settingsId, name: 'OBS-R2-96: a reader without settings.manage gets only the shared settings; a WooCommerce reader also the masked shop keys',
        layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'documents.view: shared only; woocommerce.view: plus wc keys masked; settings.manage: all masked; admin: all',
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: settingsId, name: 'OBS-R2-96: settings read scope', layer: 'regression', executionType: 'real_database',
        passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      if (addedKeys.length > 0) await orm.delete(appSettings).where(inArray(appSettings.key, addedKeys)).catch(() => undefined);
      invalidateSettingsCache();
      if (userIds.length > 0) await orm.delete(users).where(inArray(users.id, userIds)).catch(() => undefined);
      if (roleIds.length > 0) await deleteTestRoles(inArray(roles.id, roleIds)).catch(() => undefined);
    }
  }
  return results;
}
