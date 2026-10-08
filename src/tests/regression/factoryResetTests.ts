import { TestCaseResult, makeTestCase } from '../types.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/** Name of the default low-stock alert rule (test data) */
const LOW_STOCK_RULE_NAME = 'اعلان کسری موجودی به انبارداران';

/**
 * Package 1 finding B01-40, TD-620: the factory reset wiped the event rules and webhook subscriptions but ran only
 * `runSeed()`, so they stayed missing until the next restart (the low-stock alert to warehouse keepers was not sent).
 * On v9.0.389 a reset left 0 event rules and 0 webhook subscriptions; now it runs the boot's `seedDefaultEngines`.
 * Runs in its own isolated schema, like reg_factory_reset_complete_td_245.
 */
export async function runFactoryResetTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_factory_reset_restores_default_engines_td_620';
  if (!shouldRun(id, 'td620', 'b01-40', 'factory', 'reset', 'package1')) return [];
  const name = 'v9.0.390: a factory reset puts back the default workflows, event rules and webhook subscriptions and keeps the roles (TD-620)';
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
    if (subscriptions === 0) wrong.push('no default webhook subscription after the reset');
    if (workflows !== 1) wrong.push(`document approval workflow rows after the reset: ${workflows}`);
    if (await countOf('roles', `code = 'td620_custom'`) !== 1) wrong.push('the custom role was not kept');
    if (await countOf('categories') < 22) wrong.push('base data seed did not run');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `after the reset: ${rules} event rules, ${subscriptions} webhook subscriptions, the document workflow and the custom role`,
    })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
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
