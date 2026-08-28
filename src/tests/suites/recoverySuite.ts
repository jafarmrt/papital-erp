import { TestCaseResult, makeTestCase } from '../types.js';
import { SystemRecoveryService } from '../../services/recovery/systemRecovery.service.js';
import { DataReconciliationService } from '../../services/reconciliation/dataReconciliation.service.js';

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
      details: `مایگریشن ایدم‌پوتنت اجرا شد (${res.details.appliedSteps} گام). وضعیت سلامت اسکیما: ${res.details.schemaValid ? 'معتبر و کامل' : 'دارای نقص'}.`
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

  // Scenario 5: Backup Manifest & Data Restore Verification
  const t5Start = Date.now();
  try {
    const res = await SystemRecoveryService.testBackupAndRestoreIntegrity();
    results.push(makeTestCase({
      id: 'rec_backup_restore_integrity',
      scenarioId: 'recovery_backup_restore',
      name: 'تأیید ساختار مانیفست پشتیبان‌گیری و بازگردانی (Backup Manifest & Data Restore Integrity)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: res.healthy,
      durationMs: Date.now() - t5Start,
      details: `مانیفست با موفقیت نمونه‌برداری شد (${res.details.tablesInspected.length} جدول اصلی). سازگاری ساختار داده‌ها تأیید شد.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'rec_backup_restore_integrity',
      scenarioId: 'recovery_backup_restore',
      name: 'تأیید ساختار مانیفست پشتیبان‌گیری و بازگردانی (Backup Manifest & Data Restore Integrity)',
      layer: 'recovery',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t5Start,
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

  return results;
}
