import { sql, eq, and } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, outboxEvents } from '../../db/schema.js';
import { validateDbSchema } from '../../db/migrator.js';
import { logActivity } from '../../lib/auditLogger.js';
import { DeadLetterQueueService } from '../events/deadLetterQueueService.js';
import { SystemHealthService } from './systemHealth.service.js';
import { StockReconciliationService } from '../inventory/stockReconciliation.service.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

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

/** کاربر اجراکننده اقدام اصلاحی برای ثبت در تاریخچه ممیزی */
export interface ReconciliationActor {
  userId?: number;
  username?: string;
  fullName?: string;
  ipAddress?: string;
}

/**
 * v9.0.108 (TD-495): بررسی لایه موجودی از خلاصه گزارش سلامت انبار؛ مغایرت میان موجودی انبارها، موجودی کل و
 * دفتر کاردکس، یا مانده منفی کاردکس، هشدار است.
 */
export function inventoryKardexCheck(
  activeItemCount: number,
  summary: { discrepancyItems: number; negativeStockItems: number },
): IntegrityCheck {
  const discrepancies = Number(summary.discrepancyItems) || 0;
  const negatives = Number(summary.negativeStockItems) || 0;
  const healthy = discrepancies === 0 && negatives === 0;
  const fa = (n: number) => toPersianDigits(n, 0);
  const problems = [
    discrepancies > 0 ? `${fa(discrepancies)} کالا با مغایرت میان موجودی انبارها، موجودی کل و دفتر کاردکس` : '',
    negatives > 0 ? `${fa(negatives)} کالا با مانده منفی کاردکس` : '',
  ].filter(Boolean).join(' و ');
  return {
    id: 'inventory_kardex',
    category: 'انبارداری و کالاها',
    title: 'بررسی لایه موجودی و کالاها',
    status: healthy ? 'ok' : 'warning',
    details: healthy
      ? `موجودی انبارها، موجودی کل و دفتر کاردکس ${fa(activeItemCount)} کالای فعال با هم می‌خوانند.`
      : `از ${fa(activeItemCount)} کالای فعال، ${problems} یافت شد. جزئیات در بخش «انبارگردانی و تطبیق سه‌جانبه» است.`,
  };
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
    // TD-245: همان پرس‌وجوی صفحه سلامت — آستانه ۰٫۰۱ و بدون سند / ردیف حذف‌شده نرم
    const unbalancedCount = (await SystemHealthService.findUnbalancedVouchers()).length;
    checks.push({
      id: 'accounting_vouchers',
      category: 'حسابداری دوبل',
      title: 'موازنه بدهکار/بستانکار اسناد حسابداری',
      status: unbalancedCount === 0 ? 'ok' : 'error',
      details: unbalancedCount === 0 ? 'تمام اسناد حسابداری ثبت‌شده ۱۰۰٪ تراز و متوازن هستند.' : `تعداد ${unbalancedCount} سند ناهمتراز شناسایی شد که مجموع بدهکار و بستانکار آنها برابر نیست.`
    });

    // Check 4: Inventory Items Count & Stock Consistency
    // v9.0.108 (TD-495): وضعیت از خلاصه همان گزارش سلامت انبار (مغایرت سه‌طرفه یا مانده منفی کاردکس ← هشدار)، نه «سالم» ثابت
    const [itemsCountRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(items).where(eq(items.isDeleted, 0));
    checks.push(inventoryKardexCheck(itemsCountRes?.count || 0, (await StockReconciliationService.getIntegrityReport()).summary));

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

  /**
   * TD-245: رویدادهای حل‌نشده DLQ را در یک تراکنش به صف Outbox برمی‌گرداند (منطق DeadLetterQueueService؛
   * ردیف‌های replayed / dismissed دست نمی‌خورند و ردیف‌ها حذف نمی‌شوند، علامت replayed می‌خورند) و
   * ثبت ممیزی با وضعیت پیش و پس در همان تراکنش انجام می‌شود.
   */
  static async requeueDeadLetterEvents(actor: ReconciliationActor): Promise<number> {
    return orm.transaction(async (tx) => {
      const result = await DeadLetterQueueService.requeueUnresolvedToOutbox(tx, actor.userId);
      await logActivity({
        tx,
        userId: actor.userId,
        username: actor.username || 'سیستم',
        userFullName: actor.fullName || '',
        action: 'RESTORE',
        entity: 'رویدادهای سیستم',
        entityId: 'dlq_requeue',
        description: `بازگردانی ${result.requeuedCount} رویداد حل‌نشده قرنطینه DLQ به صف Outbox`,
        details: {
          requeuedCount: result.requeuedCount,
          reinsertedEventIds: result.reinsertedEventIds,
          before: result.before,
          after: result.before.map(r => ({ id: r.id, originalEventId: r.originalEventId, status: 'replayed', outboxStatus: 'pending' }))
        },
        ipAddress: actor.ipAddress || ''
      });
      return result.requeuedCount;
    });
  }

  /**
   * رویدادهای Outbox که بیش از ۵ دقیقه در حالت processing مانده‌اند را به pending برمی‌گرداند.
   * TD-245: شناسه رویدادهای بازنشانی‌شده با وضعیت پیش و پس در همان تراکنش در تاریخچه ممیزی ثبت می‌شود.
   */
  static async resetStuckOutboxEvents(actor: ReconciliationActor): Promise<number> {
    return orm.transaction(async (tx) => {
      const reset = await tx.update(outboxEvents)
        .set({ status: 'pending', retryCount: 0 })
        .where(and(eq(outboxEvents.status, 'processing'), sql`occurred_at < now() - interval '5 minutes'`))
        .returning({ id: outboxEvents.id, eventId: outboxEvents.eventId });
      await logActivity({
        tx,
        userId: actor.userId,
        username: actor.username || 'سیستم',
        userFullName: actor.fullName || '',
        action: 'UPDATE',
        entity: 'رویدادهای سیستم',
        entityId: 'outbox_stuck_reset',
        description: `بازنشانی ${reset.length} رویداد متوقف‌شده Outbox از حالت processing به pending`,
        details: {
          resetCount: reset.length,
          eventIds: reset.map(r => r.eventId),
          before: { status: 'processing' },
          after: { status: 'pending', retryCount: 0 }
        },
        ipAddress: actor.ipAddress || ''
      });
      return reset.length;
    });
  }
}
