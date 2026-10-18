import { TestCaseResult, makeTestCase } from '../types.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/** Name of the default low-stock alert rule (test data) */
const LOW_STOCK_RULE_NAME = 'اعلان کسری موجودی به انبارداران';

/**
 * Package 1 finding B01-40, TD-620: the factory reset wiped the event rules and webhook subscriptions but ran only
 * `runSeed()`, so they stayed missing until the next restart (the low-stock alert to warehouse keepers was not sent).
 * On v9.0.389 a reset left 0 event rules; now it runs the boot's `seedDefaultEngines`. Since TD-707 no demo webhook
 * subscription is seeded, so a reset leaves none.
 * Runs in its own isolated schema, like reg_factory_reset_complete_td_245.
 */
export async function runFactoryResetTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const engines = await defaultEnginesCase(shouldRun);
  if (engines) results.push(engines);
  if (shouldRun('reg_factory_reset_every_table_obs_r1_12', 'obs-r1-12', 'factory', 'reset')) results.push(await everyTableCase());
  return results;
}

async function defaultEnginesCase(shouldRun: ShouldRun): Promise<TestCaseResult | null> {
  const id = 'reg_factory_reset_restores_default_engines_td_620';
  if (!shouldRun(id, 'td620', 'b01-40', 'factory', 'reset', 'package1')) return null;
  const name = 'v9.0.390: a factory reset puts back the default workflows and event rules, seeds no webhook subscription and keeps the roles (TD-620, TD-707)';
  const tStart = Date.now();
  const fs = (await import('fs')).default;
  const os = (await import('os')).default;
  const path = (await import('path')).default;
  const { pool } = await import('../../db/drizzle.js');
  const savedPurge = process.env.ALLOW_DANGEROUS_DATA_PURGE;
  const savedAttachmentsDir = process.env.ATTACHMENTS_DIR;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-td620-'));
  let inner: { schema: string; teardown: () => Promise<void> } | null = null;
  try {
    const { setupTestSchema } = await import('../setup/testDb.js');
    const { FactoryResetService } = await import('../../services/system/factoryReset.service.js');
    inner = await setupTestSchema();
    const current = (await pool.query('SELECT current_schema() AS s')).rows[0]?.s;
    if (current !== inner.schema) throw new Error(`isolated schema not active (${current} instead of ${inner.schema}); reset not run`);
    process.env.ATTACHMENTS_DIR = path.join(tmpRoot, '.attachments');
    process.env.ALLOW_DANGEROUS_DATA_PURGE = 'true';

    await pool.query(`INSERT INTO roles (name, code, permissions) VALUES ('نقش سفارشی TD-620', 'td620_custom', '["products.view"]')`);
    const countOf = async (table: string, where = 'true'): Promise<number> =>
      Number((await pool.query(`SELECT count(*)::int AS n FROM "${inner!.schema}"."${table}" WHERE ${where}`)).rows[0]?.n ?? -1);

    await FactoryResetService.wipeAndReseed({ username: 'td620_admin', ip: '127.0.0.62' });

    const wrong: string[] = [];
    const rules = await countOf('event_action_rules');
    const subscriptions = await countOf('webhook_subscriptions');
    const workflows = await countOf('workflow_definitions', `code = 'DOC_APPROVAL_WORKFLOW'`);
    if (rules === 0) wrong.push('no event rule after the reset');
    const lowStockRule = await countOf('event_action_rules', `name = '${LOW_STOCK_RULE_NAME}'`);
    if (lowStockRule === 0) wrong.push('the low-stock alert rule is missing');
    if (subscriptions !== 0) wrong.push(`webhook subscriptions after the reset: ${subscriptions} (no demo subscription is seeded since TD-707)`);
    if (workflows !== 1) wrong.push(`document approval workflow rows after the reset: ${workflows}`);
    if (await countOf('roles', `code = 'td620_custom'`) !== 1) wrong.push('the custom role was not kept');
    if (await countOf('categories') < 22) wrong.push('base data seed did not run');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `after the reset: ${rules} event rules, ${subscriptions} webhook subscriptions, the document workflow and the custom role`,
    });
  } catch (err) {
    return makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (inner) await inner.teardown();
    if (savedPurge === undefined) delete process.env.ALLOW_DANGEROUS_DATA_PURGE; else process.env.ALLOW_DANGEROUS_DATA_PURGE = savedPurge;
    if (savedAttachmentsDir === undefined) delete process.env.ATTACHMENTS_DIR; else process.env.ATTACHMENTS_DIR = savedAttachmentsDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    // in-memory caches must not keep the inner schema's data for the next tests
    const { invalidateRoleCache, invalidateSettingsCache } = await import('../../lib/memoryCache.js');
    const { invalidateUserAuthCache } = await import('../../middleware/auth.js');
    const { invalidateTimezoneCache } = await import('../../lib/businessClock.js');
    invalidateRoleCache();
    invalidateSettingsCache();
    invalidateUserAuthCache();
    invalidateTimezoneCache();
  }
}

/**
 * v10.1.45 (OBS-R1-12): rows in tables added after TD-245 (item code history, messenger links and bots, the media
 * library, the yearly payroll rates) were never wiped, and the ones that reference an item or a user refused the whole
 * reset with a foreign-key error. Now every table is wiped in foreign-key order, the system media section «محصولات»
 * stays, and the media files of the wiped rows leave the disk after commit.
 */
async function everyTableCase(): Promise<TestCaseResult> {
  const id = 'reg_factory_reset_every_table_obs_r1_12';
  const name = 'v10.1.45: the factory reset wipes item code history, messenger, media library and payroll rate rows, their media files and an attachment\'s light copy (OBS-R1-12)';
  const tStart = Date.now();
  const fs = (await import('fs')).default;
  const os = (await import('os')).default;
  const path = (await import('path')).default;
  const { pool } = await import('../../db/drizzle.js');
  const saved = { purge: process.env.ALLOW_DANGEROUS_DATA_PURGE, attachments: process.env.ATTACHMENTS_DIR, media: process.env.MEDIA_DIR };
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-obsr112-'));
  let inner: { schema: string; teardown: () => Promise<void> } | null = null;
  try {
    const { setupTestSchema } = await import('../setup/testDb.js');
    const { FactoryResetService } = await import('../../services/system/factoryReset.service.js');
    inner = await setupTestSchema();
    process.env.ATTACHMENTS_DIR = path.join(tmpRoot, '.attachments');
    const mediaDir = path.join(tmpRoot, 'media');
    process.env.MEDIA_DIR = mediaDir;
    process.env.ALLOW_DANGEROUS_DATA_PURGE = 'true';
    const one = async (q: string, params: unknown[] = []) => (await pool.query(q, params)).rows[0] as Record<string, unknown>;

    const userId = Number((await one(`INSERT INTO users (username, password, full_name, role) VALUES ('obsr112_user', 'x', 'OBS-R1-12', 'admin') RETURNING id`)).id);
    const itemId = Number((await one(`INSERT INTO items (type, name, code, unit) VALUES ('product', 'OBS-R1-12 item', 'OBSR112-NEW', 'عدد') RETURNING id`)).id);
    await pool.query(`INSERT INTO item_code_history (item_id, old_code, new_code, reason, user_id) VALUES ($1, 'OBSR112-OLD', 'OBSR112-NEW', 'test', $2)`, [itemId, userId]);
    await pool.query(`INSERT INTO messenger_bots (messenger, token, updated_by_id) VALUES ('bale', 'enc:v1:test', $1)`, [userId]);
    await pool.query(`INSERT INTO user_messenger_links (user_id, messenger, chat_id) VALUES ($1, 'bale', '42')`, [userId]);
    await pool.query(`INSERT INTO payroll_eidi_rates (jalali_year) VALUES (1404)`);
    const sectionId = Number((await one(`INSERT INTO media_sections (kind, title) VALUES ('custom', 'OBS-R1-12 section') RETURNING id`)).id);
    const sha = 'ab'.padEnd(64, '0');
    await pool.query(`INSERT INTO media_assets (section_id, item_id, kind, mime_type, size_bytes, sha256) VALUES ($1, $2, 'image', 'image/jpeg', 10, $3)`, [sectionId, itemId, sha]);
    const original = path.join(mediaDir, 'originals', 'ab', `${sha}.jpg`);
    const thumb = path.join(mediaDir, 'thumbs', 'ab', `${sha}.webp`);
    for (const file of [original, thumb]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'x');
    }

    // v10.2 package 7: an image attachment of a sales file keeps its original and a light WEBP; both leave the disk
    const attachmentsDir = path.join(tmpRoot, '.attachments');
    const attachmentFiles = ['crm_lead/obsr112.jpg', 'crm_lead/obsr112.light.webp'].map((p) => path.join(attachmentsDir, p));
    for (const file of attachmentFiles) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'x');
    }
    await pool.query(`INSERT INTO file_attachments (id, entity_type, entity_id, storage_path, light_storage_path, original_name, mime_type, size_bytes, sha256)
      VALUES (gen_random_uuid(), 'crm_lead', 1, 'crm_lead/obsr112.jpg', 'crm_lead/obsr112.light.webp', 'a.jpg', 'image/jpeg', 1, 'x')`);

    const report = await FactoryResetService.wipeAndReseed({ username: 'obsr112_admin', ip: '127.0.0.112' });

    const wrong: string[] = [];
    for (const table of ['item_code_history', 'messenger_bots', 'user_messenger_links', 'payroll_eidi_rates', 'media_assets', 'users', 'items']) {
      const n = Number((await one(`SELECT count(*)::int AS n FROM ${table}`)).n);
      if (n !== 0) wrong.push(`${table}: ${n} row(s) left`);
    }
    if (Number((await one(`SELECT count(*)::int AS n FROM media_sections WHERE kind = 'custom'`)).n) !== 0) wrong.push('a custom media section was left');
    if (Number((await one(`SELECT count(*)::int AS n FROM media_sections WHERE kind = 'products' AND is_deleted = 0`)).n) !== 1) wrong.push('the system media section was not kept');
    if (fs.existsSync(original) || fs.existsSync(thumb)) wrong.push('the media files stayed on disk');
    if (report.mediaFiles.removed !== 1) wrong.push(`media files removed: ${report.mediaFiles.removed}`);
    const leftAttachments = attachmentFiles.filter((file) => fs.existsSync(file)).map((file) => path.basename(file));
    if (leftAttachments.length > 0) wrong.push(`attachment files stayed on disk: ${leftAttachments.join(', ')}`);
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'rows of the new tables and their media files are wiped, the system media section stays' });
  } catch (err) {
    return makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err) });
  } finally {
    if (inner) await inner.teardown();
    for (const [key, value] of [['ALLOW_DANGEROUS_DATA_PURGE', saved.purge], ['ATTACHMENTS_DIR', saved.attachments], ['MEDIA_DIR', saved.media]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    const { invalidateRoleCache, invalidateSettingsCache } = await import('../../lib/memoryCache.js');
    const { invalidateUserAuthCache } = await import('../../middleware/auth.js');
    const { invalidateTimezoneCache } = await import('../../lib/businessClock.js');
    invalidateRoleCache();
    invalidateSettingsCache();
    invalidateUserAuthCache();
    invalidateTimezoneCache();
  }
}
