import { runMigrations } from '../../db/migrator.js';
import { runSeedWithLock } from '../../db/seed.js';
import { warmDisplayTimezone } from '../../lib/businessClock.js';
import { WorkflowEngineService } from '../workflow/workflowEngineService.js';
import { EventActionEngineService } from '../events/eventActionEngineService.js';
import type { BootStep } from './bootSequence.js';

/**
 * v9.0.133 (TD-591): کارهای داده‌ای بوت، به همان ترتیب `server.ts`، تا آزمون نصب تازه همان مسیر را روی پایگاه‌داده جدا اجرا کند.
 * v10.0.22 (TD-958): گام‌ها جدا شدند؛ فقط مهاجرت ضروری است و `server.ts` آن‌ها را با `runBootSequence` اجرا می‌کند.
 */
export function bootDataSteps(): BootStep[] {
  return [
    {
      name: 'migrations',
      essential: true,
      run: async () => {
        const migResult = await runMigrations();
        if (!migResult.success) throw new Error(`Migration failed: ${migResult.errors.join(', ')}`);
      },
    },
    {
      // v9.0.134 (TD-526): base data in every environment, production too, insert-only (TD-591), no role
      name: 'base data seed',
      essential: false,
      run: async () => {
        const seed = await runSeedWithLock();
        if (!seed.success) throw new Error(`Base data seed failed: ${seed.message}`);
      },
    },
    // v9.0.429 (TD-617): the boot never touches passwords (`npm run users:lock-plain-passwords` does)
    { name: 'default workflows and event rules', essential: false, run: seedDefaultEngines },
    // v8.0.77 (TD-324): the display time zone cache is filled before the first request, outside any transaction
    { name: 'display time zone cache', essential: false, run: warmDisplayTimezone },
  ];
}

/** Every boot data step in order; any failure is thrown (fresh-install test path). */
export async function prepareDatabaseAtBoot(): Promise<void> {
  for (const step of bootDataSteps()) await step.run();
}

/**
 * v9.0.390 (TD-620، B01-40): گردش کارها و قاعده‌های رویداد پیش‌فرض، هر کدام فقط وقتی نیست. هم در بوت و هم
 * پس از بازنشانی کارخانه اجرا می‌شود که همین‌ها را پاک می‌کند، تا بازنشانی همان پیش‌فرض‌های نصب تازه را بگذارد.
 */
export async function seedDefaultEngines(): Promise<void> {
  await WorkflowEngineService.seedDefaultWorkflows();
  await EventActionEngineService.seedDefaultRules();
  // v9.0.405 (TD-707): no demo webhook subscription is seeded; the two seeded ones sent to example.com addresses
}
