import { sql, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, outboxEvents } from '../../db/schema.js';
import { validateDbSchema } from '../../db/migrator.js';
import { logActivity } from '../../lib/auditLogger.js';
import { DeadLetterQueueService } from '../events/deadLetterQueueService.js';
import { SystemHealthService, stuckOutboxCondition } from './systemHealth.service.js';
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
 * v9.0.111 (TD-495): بررسی لایه موجودی از خلاصه گزارش سلامت انبار؛ مغایرت میان موجودی انبارها، موجودی کل و
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

/**
 * v9.0.362 (TD-622، B01-42، تصمیم ت۸): پیام نتیجه دکمه‌های صف رویدادها، با رقم فارسی و بی «Outbox» و «Processing».
 */
export function requeueResultMessage(count: number): string {
  return count > 0
    ? `${toPersianDigits(count, 0)} رویداد ناموفق به صف ارسال رویدادها برگشت و دوباره اجرا می‌شود.`
    : 'هیچ رویداد ناموفقی در صف نبود.';
}

export function stuckResetResultMessage(count: number): string {
  return count > 0
    ? `${toPersianDigits(count, 0)} رویداد مانده در صف ارسال دوباره اجرا می‌شود.`
    : 'هیچ رویدادی بیش از پنج دقیقه در صف ارسال نمانده بود.';
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
      title: 'ساختار جدول‌های پایگاه‌داده',
      status: schemaReport.valid ? 'ok' : 'warning',
      details: schemaReport.valid
        ? 'همه جدول‌های لازم سامانه در پایگاه‌داده هستند.'
        : `${toPersianDigits(schemaReport.missingTables.length, 0)} جدول لازم سامانه در پایگاه‌داده نیست.`
    });

    // Check 2: Outbox & DLQ Quarantine Check
    const dlqCount = await SystemHealthService.countDeadLetterEvents();
    checks.push({
      id: 'outbox_dlq',
      category: 'صف رویدادها',
      title: 'رویدادهای ناموفق',
      status: dlqCount === 0 ? 'ok' : 'warning',
      details: dlqCount === 0
        ? 'هیچ رویداد ناموفقی در صف نیست.'
        : `${toPersianDigits(dlqCount, 0)} رویداد ناموفق در صف رویدادهای ناموفق مانده است؛ آن‌ها را بررسی کنید و در صورت نیاز دوباره اجرا کنید.`
    });

    // Check 3: Accounting Journal Vouchers Integrity
    // TD-245: همان پرس‌وجوی صفحه سلامت — آستانه ۰٫۰۱ و بدون سند / ردیف حذف‌شده نرم
    const unbalancedCount = (await SystemHealthService.findUnbalancedVouchers()).length;
    checks.push({
      id: 'accounting_vouchers',
      category: 'حسابداری دوطرفه',
      title: 'تراز بدهکار و بستانکار اسناد حسابداری',
      status: unbalancedCount === 0 ? 'ok' : 'error',
      details: unbalancedCount === 0
        ? 'همه اسناد حسابداری ثبت‌شده تراز هستند.'
        : `${toPersianDigits(unbalancedCount, 0)} سند حسابداری تراز نیست؛ جمع بدهکار و بستانکار آن‌ها برابر نیست.`
    });

    // Check 4: Inventory Items Count & Stock Consistency
    // v9.0.111 (TD-495): وضعیت از خلاصه همان گزارش سلامت انبار (مغایرت سه‌طرفه یا مانده منفی کاردکس ← هشدار)، نه «سالم» ثابت
    const [itemsCountRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(items).where(eq(items.isDeleted, 0));
    checks.push(inventoryKardexCheck(itemsCountRes?.count || 0, (await StockReconciliationService.getIntegrityReport()).summary));

    // Check 5: Workflow Engine SLA SLA Overdues
    const overdueCount = await SystemHealthService.countOverdueSlaTasks();
    checks.push({
      id: 'workflow_sla',
      category: 'گردش کار',
      title: 'مهلت انجام کارهای گردش کار',
      status: overdueCount === 0 ? 'ok' : 'warning',
      details: overdueCount === 0
        ? 'همه کارهای کارتابل در مهلت انجام خود هستند.'
        : `${toPersianDigits(overdueCount, 0)} کار در کارتابل از مهلت انجام خود گذشته است.`
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
        description: `بازگرداندن ${toPersianDigits(result.requeuedCount, 0)} رویداد ناموفق به صف ارسال رویدادها برای اجرای دوباره`,
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
        .where(stuckOutboxCondition())
        .returning({ id: outboxEvents.id, eventId: outboxEvents.eventId });
      await logActivity({
        tx,
        userId: actor.userId,
        username: actor.username || 'سیستم',
        userFullName: actor.fullName || '',
        action: 'UPDATE',
        entity: 'رویدادهای سیستم',
        entityId: 'outbox_stuck_reset',
        description: `اجرای دوباره ${toPersianDigits(reset.length, 0)} رویداد مانده در صف ارسال رویدادها`,
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
