import { TestCaseResult, makeTestCase } from '../types.js';
import { SystemRecoveryService } from '../../services/recovery/systemRecovery.service.js';
import { DataReconciliationService } from '../../services/reconciliation/dataReconciliation.service.js';
import { runBackupRestoreChecks, type RecoveryCheckOutcome } from '../recovery/backupRestoreChecks.js';
import { checkMigrationSession, checkSkippedMigrationRefused, checkUpgradeFromV70137 } from '../recovery/migrationChecks.js';
import { checkUpdateWaitsForStartup } from '../recovery/updateScriptChecks.js';

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

  // Scenario 1: Database Connection Self-Healing & KeepAlive
  const t1Start = Date.now();
  try {
    const res = await SystemRecoveryService.testDatabaseRecovery();
    results.push(makeTestCase({
      id: 'rec_db_reconnect_keepalive',
      scenarioId: 'recovery_database_restart',
      name: 'بازیابی و خودترمیمی اتصال پایگاه‌داده (Database Restart & KeepAlive Recovery)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: res.healthy,
      durationMs: Date.now() - t1Start,
      details: `اتصال پایگاه‌داده PostgreSQL فعال و پاسخگو است (تأخیر: ${res.details.latencyMs}ms). حالت بازیابی: ${res.recoveryMode}.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'rec_db_reconnect_keepalive',
      scenarioId: 'recovery_database_restart',
      name: 'بازیابی و خودترمیمی اتصال پایگاه‌داده (Database Restart & KeepAlive Recovery)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t1Start,
      error: err.message
    }));
  }

  // Scenario 2: Worker Restart Resilience & Interval Recovery
  const t2Start = Date.now();
  try {
    const res = await SystemRecoveryService.testWorkerRestartRecovery();
    results.push(makeTestCase({
      id: 'rec_worker_restart_resilience',
      scenarioId: 'recovery_worker_restart',
      name: 'توقف و راه‌اندازی مجدد ورکر پس‌زمینه (Worker Restart Resilience)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: res.healthy,
      durationMs: Date.now() - t2Start,
      details: `ورکر باکس ارسال با موفقیت متوقف و مجدداً راه‌اندازی شد. وضعیت جاری: ${res.details.restartedState ? 'فعال و در حال پردازش' : 'غیرفعال'}.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'rec_worker_restart_resilience',
      scenarioId: 'recovery_worker_restart',
      name: 'توقف و راه‌اندازی مجدد ورکر پس‌زمینه (Worker Restart Resilience)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t2Start,
      error: err.message
    }));
  }

  // Scenario 2b: Outbox Stuck Event Recovery (>5m in processing -> Reset to pending)
  const t2bStart = Date.now();
  try {
    const res = await SystemRecoveryService.testOutboxStuckEventRecovery();
    results.push(makeTestCase({
      id: 'rec_outbox_stuck_recovery',
      scenarioId: 'recovery_outbox_stuck',
      name: 'خودترمیمی رویدادهای معطل‌مانده در وضعیت پردازش (Outbox Stuck Events Auto-Recovery)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: res.healthy,
      durationMs: Date.now() - t2bStart,
      details: `بازیابی رویدادهای معطل بیش از ۵ دقیقه با موفقیت به حالت 'pending' بازنشانی گردید.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'rec_outbox_stuck_recovery',
      scenarioId: 'recovery_outbox_stuck',
      name: 'خودترمیمی رویدادهای معطل‌مانده در وضعیت پردازش (Outbox Stuck Events Auto-Recovery)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t2bStart,
      error: err.message
    }));
  }

  // Scenario 3: Webhook Retry, Outbox Retry & DLQ Quarantine Recovery
  const t3Start = Date.now();
  try {
    const res = await SystemRecoveryService.testWebhookAndOutboxRetryRecovery();
    results.push(makeTestCase({
      id: 'rec_outbox_webhook_dlq_quarantine',
      scenarioId: 'recovery_outbox_webhook_retry',
      name: 'تلاش مجدد وب‌هوک و قرنطینه در صف پیام‌های ناموفق (Webhook/Outbox Retry & DLQ Quarantine)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: res.healthy,
      durationMs: Date.now() - t3Start,
      details: `چرخه انتقال خودکار پس از ۵ تلاش ناموفق به صف DLQ و قابلیت بازیابی/حذف با موفقیت تأیید گردید.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'rec_outbox_webhook_dlq_quarantine',
      scenarioId: 'recovery_outbox_webhook_retry',
      name: 'تلاش مجدد وب‌هوک و قرنطینه در صف پیام‌های ناموفق (Webhook/Outbox Retry & DLQ Quarantine)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t3Start,
      error: err.message
    }));
  }

  // Scenario 4: Migration Failure Handling & Self-Healing
  const t4Start = Date.now();
  try {
    const res = await SystemRecoveryService.testMigrationFailureRecovery();
    results.push(makeTestCase({
      id: 'rec_migration_idempotency_self_healing',
      scenarioId: 'recovery_migration_failure_handling',
      name: 'پایداری خط لوله مایگریشن و خودترمیمی اسکیمای دیتابیس (Migration Idempotency & Schema Validation)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: res.healthy,
      durationMs: Date.now() - t4Start,
      details: `مایگریشن ایدم‌پوتنت اجرا شد (${res.details?.appliedSteps ?? 0} گام). وضعیت سلامت اسکیما: ${res.details?.schemaValid ? 'معتبر و کامل' : 'دارای نقص'}.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'rec_migration_idempotency_self_healing',
      scenarioId: 'recovery_migration_failure_handling',
      name: 'پایداری خط لوله مایگریشن و خودترمیمی اسکیمای دیتابیس (Migration Idempotency & Schema Validation)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t4Start,
      error: err.message
    }));
  }

  // Scenario 6: Mandatory 12-Point Data Integrity Reconciliation Scan (Blueprint Section 7)
  const t6Start = Date.now();
  try {
    const report = await DataReconciliationService.scanIntegrity();
    // In our live database with clean seed, anomalies should be 0 or auto-repaired
    const passed = report.criticalCount === 0;

    results.push(makeTestCase({
      id: 'rec_data_integrity_reconciliation_scan',
      scenarioId: 'recovery_data_integrity_reconciliation',
      name: 'پویش ۱۲ گانه تطبیق و یکپارچگی داده‌ها (12-Point Data Integrity Reconciliation Scan)',
      layer: 'recovery',
      executionType: 'real_database',
      passed,
      durationMs: Date.now() - t6Start,
      details: `پویش یکپارچگی داده‌ها انجام شد: کدهای تکراری (${report.summary.duplicateItemCodes})، موجودی منفی (${report.summary.negativeStockCount})، اسناد نامتوازن (${report.summary.unbalancedVouchersCount})، سفارشات تکراری (${report.summary.duplicateWooCommerceOrders}). خطای بحرانی: ${report.criticalCount}`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'rec_data_integrity_reconciliation_scan',
      scenarioId: 'recovery_data_integrity_reconciliation',
      name: 'پویش ۱۲ گانه تطبیق و یکپارچگی داده‌ها (12-Point Data Integrity Reconciliation Scan)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t6Start,
      error: err?.message || String(err)
    }));
  }

  await runMigrationAndBackupChecks(results);

  return results;
}
