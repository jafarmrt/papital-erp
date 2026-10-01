import { logger } from '../../middleware/logger.js';
import { runSeedWithLock } from '../../db/seed.js';
import { WorkflowEngineService } from '../../services/workflow/workflowEngineService.js';

/**
 * v7.0.24 (TD-174) — Production-equivalent master-data bootstrap for the test runner
 * ==================================================================================
 * `server.ts` always runs the master-data seed (22 standard categories, roles, settings,
 * piecework tasks, standard chart of accounts, workflow definitions) and the default
 * workflow seed right after migrations. The test runner previously skipped this step, so
 * on a fresh database (CI, isolated test schema) every test that relies on that baseline
 * failed (category baseline, automatic sales voucher, COGS mapping, SLA analytics) or only
 * passed when an earlier suite happened to create the data.
 *
 * Only idempotent master-data seeding is mirrored here — no users, no background workers,
 * no outbound webhooks, no voucher re-sync.
 */
export async function bootstrapTestMasterData(): Promise<void> {
  const seedResult = await runSeedWithLock();
  if (!seedResult.success) {
    throw new Error(`[TestBootstrap] Master-data seed failed: ${seedResult.message}`);
  }
  await WorkflowEngineService.seedDefaultWorkflows();
  logger.info('[TestBootstrap] Production-equivalent master data seeded for the test run.');
}
