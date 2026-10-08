import { TestCaseResult, makeTestCase } from '../types.js';
import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { outboxEvents } from '../../db/schema.js';
import { OutboxService } from '../../services/events/outboxService.js';
import { runBackupRestoreChecks, type RecoveryCheckOutcome } from '../recovery/backupRestoreChecks.js';
import { checkMigrationNoticesReported, checkMigrationSession, checkSkippedMigrationRefused, checkUpgradeFromV70137 } from '../recovery/migrationChecks.js';
import { checkUpdateWaitsForStartup } from '../recovery/updateScriptChecks.js';
import { runDeploySafetyChecks } from '../recovery/deploySafetyChecks.js';
import { runToolingChecks } from '../recovery/toolingChecks.js';
import { checkNestedSchemaComplete, checkTestSchemaKeepsPublic } from '../recovery/schemaIsolationChecks.js';

/** حوزه K (v8.0.81 به بعد): مهاجرت، به‌روزرسانی، پشتیبان و بازیابی با اسکریپت‌ها و پایگاه‌داده واقعی */
async function runMigrationAndBackupChecks(results: TestCaseResult[]): Promise<void> {
  const single: Array<[string, string, () => Promise<string[]>, string]> = [
    ['rec_td_364_skipped_migration_refused', 'v8.0.81: a migration whose when is smaller than the last applied migration (like drizzle-kit generate output) is not skipped silently and the run stops naming it; a database ahead of the version is refused too (TD-364)',
      checkSkippedMigrationRefused, 'The late migration was refused by name, the same migration with a correct when ran, and the database ahead was refused'],
    ['rec_td_366_migration_session', 'v8.0.82: migrations run on a separate connection without the 60-second request timeout and two concurrent runs queue (TD-366)',
      checkMigrationSession, 'Two concurrent runs both succeeded with no duplicate row in the migration journal; the statement timeout in the migration is 0'],
    ['rec_td_368_upgrade_from_v7_0_137', 'v8.0.89: upgrading a server from v7.0.137 with a cheque voucher of a closed fiscal year whose date 0044 did not convert does not break in migration 0047; the voucher is linked and its date and NOT VALID constraint stay untouched (TD-368)',
      checkUpgradeFromV70137, 'The upgrade from level 0044 with the refused voucher succeeded; the cheque link was recorded and the date and NOT VALID constraint stayed untouched'],
    ['rec_td_365_update_waits_for_startup', 'v8.0.83: update.sh reports success only after migrations and startup end (/health/startup) with the right version (TD-365)',
      checkUpdateWaitsForStartup, 'Migrating and a stale version were refused, a started server with the right version was accepted; an unknown argument gave a clear message'],
    ['rec_td_590_test_schema_keeps_public', 'v9.0.425: building an isolated test schema drops no index or function of the same name in public (TD-590)',
      checkTestSchemaKeepsPublic, 'Every public index and function named by a migration DROP survived a nested test schema'],
    ['rec_td_610_nested_schema_complete', 'v9.0.426: a test schema built beside a migrated one has every constraint, index and trigger the migrations name (TD-610)',
      checkNestedSchemaComplete, 'The nested test schema has every migration-named object of the suite schema and every index public also holds'],
    ['rec_td_589_migration_notices_reported', 'v9.0.427: a migration that leaves a constraint or index out says so in the migrator warnings and log (TD-589)',
      checkMigrationNoticesReported, 'The SKIPPED warning and the "not created" notice are in warnings; an ordinary notice is not'],
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
    outcomes.push({ id: 'rec_td_362_backup_from_any_directory', name: 'Area K: backup and restore', info: '', violations: [err instanceof Error ? err.message : String(err)] });
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
  const name = 'Outbox stuck events auto-recovery: events stuck in processing are recovered';
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
