import { logger } from '../../middleware/logger.js';
import { runSeedWithLock } from '../../db/seed.js';
import { WorkflowEngineService } from '../../services/workflow/workflowEngineService.js';
import { registerWorkflowDomainActions } from '../../services/system/workflowDomainActions.js';
import { orm } from '../../db/drizzle.js';
import { roles } from '../../db/schema.js';
import { ROLE_TEMPLATES } from '../../lib/permissions/roleTemplates.js';
import { withRequiredPermissions } from '../../lib/permissions/permissionCatalog.js';

/**
 * v7.0.24 (TD-174) — Production-equivalent master-data bootstrap for the test runner
 * ==================================================================================
 * `server.ts` runs the master-data seed (22 standard categories, settings, piecework tasks,
 * standard chart of accounts, workflow definitions) and the default workflow seed right after
 * migrations — in production too since v9.0.134 (TD-526; until then production skipped it unless
 * ALLOW_SEED_IN_PRODUCTION=true). The test runner previously skipped this step, so
 * on a fresh database (CI, isolated test schema) every test that relies on that baseline
 * failed (category baseline, automatic sales voucher, COGS mapping, SLA analytics) or only
 * passed when an earlier suite happened to create the data.
 *
 * Only idempotent master-data seeding is mirrored here — no users, no background workers,
 * no outbound webhooks, no voucher re-sync.
 *
 * v9.0.2 (TD-415): the workflow post-transition actions are registered exactly as server.ts does,
 * so workflow tests run the same in-transaction domain actions as production.
 *
 * v9.0.134 (TD-526): the seed creates no role any more (a fresh install has only the system admin role,
 * migration 0066). Tests sign in with the roles of the role templates (`ROLE_TEMPLATES`), so this test-only
 * step creates every template role whose code is missing, exactly as an admin would from the roles page.
 */
export async function bootstrapTestMasterData(): Promise<void> {
  const seedResult = await runSeedWithLock();
  if (!seedResult.success) {
    throw new Error(`[TestBootstrap] Master-data seed failed: ${seedResult.message}`);
  }
  await WorkflowEngineService.seedDefaultWorkflows();
  await createTemplateRolesForTests();
  registerWorkflowDomainActions();
  logger.info('[TestBootstrap] Production-equivalent master data seeded for the test run.');
}

/** Test-only: one role per template whose code is missing (insert-only, like the admin's «ساخت نقش از الگو») */
async function createTemplateRolesForTests(): Promise<void> {
  const existing = new Set((await orm.select({ code: roles.code }).from(roles)).map(r => r.code));
  const missing = ROLE_TEMPLATES.filter(t => !existing.has(t.code));
  if (missing.length === 0) return;
  await orm.insert(roles).values(missing.map(t => ({
    name: t.name,
    code: t.code,
    description: t.description,
    permissions: withRequiredPermissions([...t.permissions]),
    isSystem: 0,
  }))).onConflictDoNothing();
}
