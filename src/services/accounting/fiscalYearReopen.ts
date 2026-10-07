import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { fiscalPeriods, journalVouchers } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { FiscalPeriodService } from './fiscalPeriod.service.js';
import { VoucherService } from './voucher.service.js';
import { resolveFiscalClosingDates } from './fiscalYear.service.js';
import { lockFiscalYearSequence } from './fiscalYearOrder.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { FiscalYearReopenResult } from '../../types.js';

type ReopenedVoucher = FiscalYearReopenResult['voidedVouchers'][number];

/**
 * v9.0.145 (TD-543، B03-01، تصمیم ت۲ مالک محصول): بازگشایی آخرین سال مالی بسته. پیش‌تر هیچ راهی در محصول برای باز کردن
 * سال نبود و سالی که زود یا اشتباه بسته شده بود فقط با دستکاری پایگاه‌داده باز می‌شد.
 *
 * فقط آخرین سال بسته (همه سال‌های پس از آن باز)، با مجوز `accounting.fiscal_reopen` و دلیل الزامی. در یک تراکنش زیر قفل
 * ترتیب سال‌ها و قفل ردیف سال در `fiscal_periods`: سال باز می‌شود و اسناد فعال آخرین اجرای بستن همان سال (پیوند
 * `source_fiscal_year`، نه شماره مرجع) با `voidSourceVoucher` بی‌اثر می‌شوند — سند برگشت به تاریخ خود سند، با همان نوع و
 * پیوند (TD-559) — و ممیزی با قبل و بعد در همان تراکنش ثبت می‌شود.
 */

/** پیشوند مرجع اسناد برگشت (خودشان سند اجرای بستن نیستند) */
const REVERSAL_REFERENCE = sql`(COALESCE(${journalVouchers.referenceNumber}, '') LIKE 'REV-V%'
  OR COALESCE(${journalVouchers.referenceNumber}, '') LIKE 'RE-REV-V%'
  OR COALESCE(${journalVouchers.referenceNumber}, '') LIKE 'VOID-REPOST-V%')`;

/** اسناد فعال آخرین اجرای بستن سال: پیوند سال، نه برگشت، و بی برگشت فعال؛ آخرین سند نخست (افتتاحیه پیش از اختتامیه) */
async function activeClosingRunVouchers(tx: DbExecutor, year: number) {
  return tx.select({
    id: journalVouchers.id,
    voucherNumber: journalVouchers.voucherNumber,
    date: journalVouchers.date,
    referenceNumber: journalVouchers.referenceNumber,
  })
    .from(journalVouchers)
    .where(and(
      eq(journalVouchers.isDeleted, 0),
      eq(journalVouchers.sourceFiscalYear, year),
      sql`NOT ${REVERSAL_REFERENCE}`,
      sql`NOT EXISTS (SELECT 1 FROM journal_vouchers r
                       WHERE r.is_deleted = 0 AND r.reference_id = ${journalVouchers.id}
                         AND r.reference_number IN ('REV-V' || ${journalVouchers.voucherNumber}, 'VOID-REPOST-V' || ${journalVouchers.voucherNumber}))`
    ))
    .orderBy(desc(journalVouchers.id));
}

export async function reopenFiscalYear(params: {
  year: unknown;
  reason: unknown;
  userId?: number;
  username?: string;
  userFullName?: string;
  ipAddress?: string;
}): Promise<FiscalYearReopenResult> {
  const { year } = resolveFiscalClosingDates(params.year);
  const reason = String(params.reason ?? '').trim();
  if (!reason) {
    throw new ValidationError('دلیل بازگشایی سال مالی را بنویسید.', { field: 'reason' }, 'FISCAL_REOPEN_REASON_REQUIRED');
  }

  return orm.transaction(async (tx) => {
    await lockFiscalYearSequence(tx);
    const before = await FiscalPeriodService.lockForReopen(tx, year);
    const later = await tx.select({ fiscalYear: fiscalPeriods.fiscalYear }).from(fiscalPeriods)
      .where(and(gt(fiscalPeriods.fiscalYear, year), eq(fiscalPeriods.status, 'closed')))
      .orderBy(desc(fiscalPeriods.fiscalYear));
    if (later.length > 0) {
      const years = later.map(l => l.fiscalYear);
      const fa = (y: number) => toPersianDigits(y);
      throw new ConflictError(
        `فقط آخرین سال مالی بسته بازگشایی می‌شود؛ سال ${years.map(fa).join('، ')} پس از ${fa(year)} بسته است. ابتدا سال ${fa(years[0])} را بازگشایی کنید.`,
        { laterClosedYears: years },
        'FISCAL_YEAR_LATER_CLOSED'
      );
    }

    await FiscalPeriodService.markOpen(tx, year);
    const voided: ReopenedVoucher[] = [];
    for (const v of await activeClosingRunVouchers(tx, year)) {
      const outcome = await VoucherService.voidSourceVoucher({
        voucherId: v.id,
        date: v.date,
        reason: `بازگشایی سال مالی ${year}: ${reason}`,
        userId: params.userId,
        username: params.username,
        externalTx: tx,
        allowYearEndClosing: true,
      });
      voided.push({ id: v.id, voucherNumber: Number(v.voucherNumber), referenceNumber: v.referenceNumber ?? '', ...outcome });
    }

    await logActivity({
      tx,
      userId: params.userId,
      username: params.username,
      userFullName: params.userFullName,
      ipAddress: params.ipAddress,
      action: 'UPDATE',
      entity: 'سال مالی',
      entityId: year,
      description: `بازگشایی سال مالی ${year} (دلیل: ${reason})`,
      details: {
        before: { status: 'closed', ...before },
        after: { status: 'open' },
        reason,
        voidedVouchers: voided,
      },
    });

    return {
      success: true as const,
      year,
      message: `سال مالی ${toPersianDigits(year)} بازگشایی شد و ${toPersianDigits(voided.length)} سند بستن آن سال بی‌اثر شد.`,
      voidedVouchers: voided,
    };
  });
}
