import { runMigrations } from '../../db/migrator.js';
import { runSeedWithLock } from '../../db/seed.js';
import { warmDisplayTimezone } from '../../lib/businessClock.js';
import { WorkflowEngineService } from '../workflow/workflowEngineService.js';
import { EventActionEngineService } from '../events/eventActionEngineService.js';
import { WebhookSubscriptionService } from '../events/webhookSubscriptionService.js';

/**
 * v9.0.133 (TD-591): کارهای داده‌ای بوت، به همان ترتیب `server.ts`، در یک تابع تا آزمون نصب تازه همان مسیر را روی
 * پایگاه‌داده جدا اجرا کند. خطا برانداخته می‌شود و `server.ts` تا پنج بار دوباره می‌کوشد.
 */
export async function prepareDatabaseAtBoot(): Promise<void> {
  const migResult = await runMigrations();
  if (!migResult.success) {
    throw new Error(`Migration failed: ${migResult.errors.join(', ')}`);
  }
  // v9.0.134 (TD-526، تصمیم ت۶ بازنگری‌شده الف): داده پایه در هر محیط، تولید هم، فقط «درج آنچه نیست» (TD-591) و بی هیچ نقشی؛
  // متغیر ALLOW_SEED_IN_PRODUCTION بازنشسته شد
  const seed = await runSeedWithLock();
  if (!seed.success) throw new Error(`Base data seed failed: ${seed.message}`);
  // v9.0.398 (TD-617, decision t4 «الف»): the boot never touches passwords; non-bcrypt values are locked by the one-off
  // `npm run users:lock-plain-passwords`, never turned into working passwords
  await seedDefaultEngines();
  // v8.0.77 (TD-324): کش منطقه زمانی پیش از اولین درخواست، بیرون از هر تراکنش پر می‌شود
  await warmDisplayTimezone();
}

/**
 * v9.0.390 (TD-620، B01-40): گردش کارها، قاعده‌های رویداد و اشتراک‌های پیش‌فرض، هر کدام فقط وقتی نیست. هم در بوت و هم
 * پس از بازنشانی کارخانه اجرا می‌شود که همین‌ها را پاک می‌کند، تا بازنشانی همان پیش‌فرض‌های نصب تازه را بگذارد.
 */
export async function seedDefaultEngines(): Promise<void> {
  await WorkflowEngineService.seedDefaultWorkflows();
  await EventActionEngineService.seedDefaultRules();
  await WebhookSubscriptionService.seedDefaultSubscriptions();
}
