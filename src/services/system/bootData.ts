import { logger } from '../../middleware/logger.js';
import { runMigrations } from '../../db/migrator.js';
import { runSeedWithLock } from '../../db/seed.js';
import { migratePlainPasswords } from '../../db/migratePlainPasswords.js';
import { warmDisplayTimezone } from '../../lib/businessClock.js';
import { WorkflowEngineService } from '../workflow/workflowEngineService.js';
import { EventActionEngineService } from '../events/eventActionEngineService.js';
import { WebhookSubscriptionService } from '../events/webhookSubscriptionService.js';

/**
 * v9.0.116 (TD-591): کارهای داده‌ای بوت، به همان ترتیب `server.ts`، در یک تابع تا آزمون نصب تازه همان مسیر را روی
 * پایگاه‌داده جدا اجرا کند. خطا برانداخته می‌شود و `server.ts` تا پنج بار دوباره می‌کوشد.
 */
export async function prepareDatabaseAtBoot(): Promise<void> {
  const migResult = await runMigrations();
  if (!migResult.success) {
    throw new Error(`Migration failed: ${migResult.errors.join(', ')}`);
  }
  if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_SEED_IN_PRODUCTION === 'true') {
    await runSeedWithLock();
  } else {
    logger.info('[Startup] Skipping seed in production (set ALLOW_SEED_IN_PRODUCTION=true to enable)');
  }
  await migratePlainPasswords();
  await WorkflowEngineService.seedDefaultWorkflows();
  await EventActionEngineService.seedDefaultRules();
  await WebhookSubscriptionService.seedDefaultSubscriptions();
  // v8.0.77 (TD-324): کش منطقه زمانی پیش از اولین درخواست، بیرون از هر تراکنش پر می‌شود
  await warmDisplayTimezone();
}
