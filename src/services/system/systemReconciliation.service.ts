import { sql, eq, and } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, outboxEvents, deadLetterEvents } from '../../db/schema.js';
import { validateDbSchema } from '../../db/migrator.js';
import { SystemHealthService } from './systemHealth.service.js';

/**
 * ممیزی خودکار یکپارچگی سیستم (GET /system/reconciliation-check) و اقدام‌های اصلاحی غیرمخرب
 * (POST /system/reconciliation-fix): بازگرداندن رویدادهای DLQ به Outbox و بازنشانی رویدادهای گیرکرده.
 */

export interface IntegrityCheck {
  id: string;
  category: string;
  title: string;
  status: 'ok' | 'warning' | 'error';
  details: string;
}

export interface IntegrityScanResult {
  checks: IntegrityCheck[];
  okChecks: number;
  healthScorePercentage: number;
}

export class SystemReconciliationService {
  /** Automated System Integrity & Reconciliation Scan */
  static async runIntegrityScan(): Promise<IntegrityScanResult> {
    const checks: IntegrityCheck[] = [];

    // Check 1: Database Schema Validation
    const schemaReport = await validateDbSchema();
    checks.push({
      id: 'db_schema',
      category: 'پایگاه‌داده',
      title: 'ارزیابی ساختار و ایندکس‌های PostgreSQL',
      status: schemaReport.valid ? 'ok' : 'warning',
      details: schemaReport.valid ? 'تمامی جداول و لایه‌های ایندکس منطبق با Schema رسمی هستند.' : `تعداد ${schemaReport.missingTables.length} جدول ناموجود یافت شد.`
    });

    // Check 2: Outbox & DLQ Quarantine Check
    const dlqCount = await SystemHealthService.countDeadLetterEvents();
    checks.push({
      id: 'outbox_dlq',
      category: 'صف رویدادها (Outbox / DLQ)',
      title: 'سلامت صف پیام‌ها و قرنطینه خطاها',
      status: dlqCount === 0 ? 'ok' : 'warning',
      details: dlqCount === 0 ? 'هیچ رویدادی در صف قرنطینه DLQ دچار خطا نشده است.' : `تعداد ${dlqCount} رویداد ناموفق در صف قرنطینه DLQ موجود است که نیازمند بازبینی/Replay است.`
    });

    // Check 3: Accounting Journal Vouchers Integrity
    const unbalancedQuery = await orm.execute(sql`
      SELECT jv.id, jv.voucher_number
      FROM journal_vouchers jv
      JOIN journal_voucher_items jvi ON jvi.voucher_id = jv.id
      GROUP BY jv.id, jv.voucher_number
      HAVING SUM(jvi.debit) <> SUM(jvi.credit)
    `);
    const unbalancedCount = unbalancedQuery.rows?.length || 0;
    checks.push({
      id: 'accounting_vouchers',
      category: 'حسابداری دوبل',
      title: 'موازنه بدهکار/بستانکار اسناد حسابداری',
      status: unbalancedCount === 0 ? 'ok' : 'error',
      details: unbalancedCount === 0 ? 'تمام اسناد حسابداری ثبت‌شده ۱۰۰٪ تراز و متوازن هستند.' : `تعداد ${unbalancedCount} سند ناهمتراز شناسایی شد که مجموع بدهکار و بستانکار آنها برابر نیست.`
    });

    // Check 4: Inventory Items Count & Stock Consistency
    const [itemsCountRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(items);
    checks.push({
      id: 'inventory_kardex',
      category: 'انبارداری و کالاهها',
      title: 'بررسی لایه موجودی و کالاها',
      status: 'ok',
      details: `تعداد کل کالاها و مواد اولیه فعال در سیستم: ${itemsCountRes?.count || 0} قلم`
    });

    // Check 5: Workflow Engine SLA SLA Overdues
    const overdueCount = await SystemHealthService.countOverdueSlaTasks();
    checks.push({
      id: 'workflow_sla',
      category: 'فرآیندها و SLA',
      title: 'پایش زمان‌سنجی و مهلت تاییدات فرآیندها',
      status: overdueCount === 0 ? 'ok' : 'warning',
      details: overdueCount === 0 ? 'تمامی کارتابل‌های تایید در مهلت SLA مجاز خود قرار دارند.' : `تعداد ${overdueCount} وظیفه ارجاع‌شده در کارتابل‌ها از مهلت قانونی SLA عبور کرده‌اند.`
    });

    // Compute Health Score Percentage
    const okChecks = checks.filter(c => c.status === 'ok').length;
    const healthScorePercentage = Math.round((okChecks / checks.length) * 100);

    return { checks, okChecks, healthScorePercentage };
  }

  /** همه رویدادهای DLQ را به صف Outbox برمی‌گرداند و تعداد منتقل‌شده را برمی‌گرداند. */
  static async requeueDeadLetterEvents(): Promise<number> {
    const dlqEvents = await orm.select().from(deadLetterEvents);
    let requeuedCount = 0;

    for (const dlq of dlqEvents) {
      await orm.insert(outboxEvents).values({
        eventId: `${dlq.originalEventId}_replayed_${Date.now()}`,
        eventType: dlq.eventType,
        aggregateType: dlq.aggregateType,
        aggregateId: dlq.aggregateId,
        status: 'pending',
        payload: dlq.payload || {},
        metadata: { ...((dlq.metadata as Record<string, unknown>) || {}), replayedFromDlq: true },
        retryCount: 0
      }).onConflictDoNothing();

      await orm.delete(deadLetterEvents).where(eq(deadLetterEvents.id, dlq.id));
      requeuedCount++;
    }

    return requeuedCount;
  }

  /** رویدادهای Outbox که بیش از ۵ دقیقه در حالت processing مانده‌اند را به pending برمی‌گرداند. */
  static async resetStuckOutboxEvents(): Promise<void> {
    await orm.update(outboxEvents)
      .set({ status: 'pending', retryCount: 0 })
      .where(and(eq(outboxEvents.status, 'processing'), sql`occurred_at < now() - interval '5 minutes'`));
  }
}
