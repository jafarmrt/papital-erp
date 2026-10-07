import { TestCaseResult, makeTestCase } from '../types.js';
import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { outboxEvents } from '../../db/schema.js';
import { OutboxService } from '../../services/events/outboxService.js';
import { runBackupRestoreChecks, type RecoveryCheckOutcome } from '../recovery/backupRestoreChecks.js';
import { checkMigrationSession, checkSkippedMigrationRefused, checkUpgradeFromV70137 } from '../recovery/migrationChecks.js';
import { checkUpdateWaitsForStartup } from '../recovery/updateScriptChecks.js';
import { runDeploySafetyChecks } from '../recovery/deploySafetyChecks.js';
import { runToolingChecks } from '../recovery/toolingChecks.js';

/** حوزه K (v8.0.81 به بعد): مهاجرت، به‌روزرسانی، پشتیبان و بازیابی با اسکریپت‌ها و پایگاه‌داده واقعی */
async function runMigrationAndBackupChecks(results: TestCaseResult[]): Promise<void> {
  const single: Array<[string, string, () => Promise<string[]>, string]> = [
    ['rec_td_364_skipped_migration_refused', 'v8.0.81: مهاجرتی که when آن از آخرین مهاجرت اجراشده کوچک‌تر است (مثل خروجی drizzle-kit generate) بی‌صدا رد نمی‌شود و اجرا با نام آن متوقف می‌شود؛ پایگاه‌داده جلوتر از نسخه هم پذیرفته نمی‌شود (TD-364)',
      checkSkippedMigrationRefused, 'مهاجرت عقب‌افتاده با نامش رد شد، همان مهاجرت با when درست اجرا شد و پایگاه‌داده جلوتر رد شد'],
    ['rec_td_366_migration_session', 'v8.0.82: مهاجرت‌ها روی اتصال جدا و بی مهلت ۶۰ ثانیه‌ای درخواست‌ها اجرا می‌شوند و دو اجرای هم‌زمان پشت هم می‌روند (TD-366)',
      checkMigrationSession, 'دو اجرای هم‌زمان هر دو موفق و دفتر بی ردیف تکراری؛ مهلت دستور در مهاجرت ۰'],
    ['rec_td_368_upgrade_from_v7_0_137', 'v8.0.89: ارتقای سرور از v7.0.137 با سند چکِ سال مالی بسته که 0044 تاریخش را تبدیل نکرده، در مهاجرت 0047 نمی‌شکند؛ سند پیوند می‌خورد و تاریخ و قید NOT VALID آن دست نمی‌خورد (TD-368)',
      checkUpgradeFromV70137, 'ارتقا از سطح 0044 با سند ردشده انجام شد؛ پیوند چک ثبت، تاریخ و قید NOT VALID دست‌نخورده ماند'],
    ['rec_td_365_update_waits_for_startup', 'v8.0.83: update.sh فقط پس از پایان مهاجرت‌ها و راه‌اندازی (/health/startup) و نسخه درست موفقیت اعلام می‌کند (TD-365)',
      checkUpdateWaitsForStartup, 'در حال مهاجرت و نسخه کهنه رد شد، راه‌افتاده با نسخه درست پذیرفته شد؛ آرگومان ناشناخته پیام روشن داد'],
  ];
  const outcomes: RecoveryCheckOutcome[] = [];
  for (const [id, name, fn, info] of single) {
    const start = Date.now();
    let violations: string[];
    try {
      violations = await fn();
    } catch (err: unknown) {
      violations = [err instanceof Error ? err.message : String(err)];
    }
    results.push(makeTestCase({
      id, name, layer: 'recovery', executionType: 'real_database', passed: violations.length === 0, durationMs: Date.now() - start,
      ...(violations.length === 0 ? { details: info } : { error: violations.join(' | ') }),
    }));
  }
  const start = Date.now();
  try {
    outcomes.push(...await runBackupRestoreChecks());
  } catch (err: unknown) {
    outcomes.push({ id: 'rec_td_362_backup_from_any_directory', name: 'حوزه K: پشتیبان و بازیابی', info: '', violations: [err instanceof Error ? err.message : String(err)] });
  }
  try {
    outcomes.push(...await runDeploySafetyChecks());
  } catch (err: unknown) {
    outcomes.push({ id: 'rec_td_581_cleanup_script_guarded', name: 'Package 1: deploy and cleanup script safety', info: '', violations: [err instanceof Error ? err.message : String(err)] });
  }
  try {
    outcomes.push(...await runToolingChecks());
  } catch (err: unknown) {
    outcomes.push({ id: 'rec_td_603_update_rollback_stays_on_branch', name: 'Package 1: operations tooling', info: '', violations: [err instanceof Error ? err.message : String(err)] });
  }
  for (const o of outcomes) {
    results.push(makeTestCase({
      id: o.id, scenarioId: o.scenarioId, name: o.name, layer: 'recovery', executionType: 'real_database',
      passed: o.violations.length === 0, durationMs: Date.now() - start,
      ...(o.violations.length === 0 ? { details: o.info } : { error: o.violations.join(' | ') }),
    }));
  }
}

export async function runRecoveryTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // رویداد Outbox که بیش از ۵ دقیقه در «processing» مانده به «pending» برمی‌گردد (OutboxService.recoverStuckEvents)
  const name = 'خودترمیمی رویدادهای معطل‌مانده در وضعیت پردازش (Outbox Stuck Events Auto-Recovery)';
  const started = Date.now();
  const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  let stuckId: number | undefined;
  try {
    const [stuck] = await orm.insert(outboxEvents).values({
      eventId: `evt_stuck_test_${Date.now()}`,
      eventType: 'recovery.stuck.test',
      aggregateType: 'system_recovery',
      aggregateId: 'test_stuck_1',
      payload: { test: true },
      metadata: { timestamp: sixMinutesAgo },
      status: 'processing',
      lockedAt: sixMinutesAgo,
      lockedBy: 'worker-crashed',
      retryCount: 0
    }).returning();
    stuckId = stuck.id;
    const recoveredCount = await OutboxService.recoverStuckEvents(5);
    const [after] = await orm.select().from(outboxEvents).where(eq(outboxEvents.id, stuck.id));
    const passed = recoveredCount > 0 && after?.status === 'pending' && after.retryCount === 1;
    results.push(makeTestCase({
      id: 'rec_outbox_stuck_recovery', scenarioId: 'recovery_outbox_stuck', name, layer: 'recovery', executionType: 'real_database',
      passed, durationMs: Date.now() - started,
      ...(passed
        ? { details: 'رویداد معطل بیش از ۵ دقیقه به pending بازنشانی شد و شمار تلاش آن یکی بالا رفت.' }
        : { error: `بازنشانی نشد: recovered=${recoveredCount}، status=${after?.status}، retryCount=${after?.retryCount}` }),
    }));
  } catch (err: unknown) {
    results.push(makeTestCase({
      id: 'rec_outbox_stuck_recovery', scenarioId: 'recovery_outbox_stuck', name, layer: 'recovery', executionType: 'real_database',
      passed: false, durationMs: Date.now() - started, error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (stuckId !== undefined) await orm.delete(outboxEvents).where(eq(outboxEvents.id, stuckId));
  }

  await runMigrationAndBackupChecks(results);

  return results;
}
