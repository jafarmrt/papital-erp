import { pool } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { ChartOfAccountsService } from '../../services/accounting/chartOfAccounts.service.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { getErrorMessage } from '../../utils/formatters.js';

/**
 * v8.0.47 — سناریوهای سخت‌گیرانه مرز تاریخ (حوزه I نقشه راه V8) برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

/** سال کبیسه ۱۳۸۷: ۳۰ اسفند = 2009-03-20 و ۱ فروردین ۱۳۸۸ = 2009-03-21؛ دور از سال‌های آزمون‌های دیگر */
const LEAP_CLOSING_YEAR = 1387;
const LEAP_FIRST_DAY = '2008-03-20';
const LEAP_LAST_DAY = '2009-03-20';
const NEXT_FIRST_DAY = '2009-03-21';

async function revenueOfYear(accountId: number): Promise<string> {
  const res = await pool.query<{ bal: string }>(
    `SELECT COALESCE(SUM(i.credit - i.debit), 0)::text AS bal
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND v.status IN ('approved', 'permanent')
        AND i.account_id = $1 AND v.date >= $2 AND v.date < $3`,
    [accountId, LEAP_FIRST_DAY, NEXT_FIRST_DAY]);
  return fin(res.rows[0]?.bal ?? 0).toString();
}

/**
 * TD-310: بستن سال مالی کبیسه، سند ۳۰ اسفند را هم می‌بندد. اسناد اختتامیه به آخرین روز سال و افتتاحیه به ۱ فروردین سال
 * بعد صادر می‌شوند، تاریخ دیگری پذیرفته نمی‌شود و پس از بستن، مانده درآمد سال صفر است.
 */
export async function checkClosingCoversLeapLastDay(): Promise<string[]> {
  const problems: string[] = [];
  await ChartOfAccountsService.seedStandardAccounts();
  const all = await ChartOfAccountsService.getAllAccounts();
  const revenue = all.find(a => a.code === '6001') || all.find(a => a.accountType === 'revenue');
  const asset = all.find(a => a.code === '1101') || all.find(a => a.accountType === 'asset');
  if (!revenue || !asset) return ['سرفصل درآمد یا دارایی آزمون یافت نشد'];

  const sale = (date: string, amount: number, ref: string) => VoucherService.createJournalVoucher({
    date, voucherType: 'general', status: 'approved', description: `فروش آزمون مرز سال ${ref}`,
    referenceModule: 'manual', referenceNumber: `TEST-TD310-${ref}`,
    items: [
      { accountId: asset.id, detailedType: 'other', detailedName: 'دارایی آزمون', debit: amount, credit: 0, description: 'بدهکار' },
      { accountId: revenue.id, detailedType: 'other', detailedName: 'درآمد آزمون', debit: 0, credit: amount, description: 'بستانکار' },
    ],
  });
  await sale('2008-06-15', 1000000, 'MID');
  await sale(LEAP_LAST_DAY, 500000, 'LAST'); // ۳۰ اسفند ۱۳۸۷

  const preview = await FiscalYearService.getFiscalYearClosingPreview({ year: LEAP_CLOSING_YEAR });
  if (preview.closingDate !== LEAP_LAST_DAY || preview.openingDateNewYear !== NEXT_FIRST_DAY) {
    problems.push(`تاریخ‌های پیش‌نمایش ${preview.closingDate} و ${preview.openingDateNewYear} است؛ انتظار ${LEAP_LAST_DAY} و ${NEXT_FIRST_DAY}`);
  }
  if (!fin(preview.netProfit).equals(1500000)) {
    problems.push(`سود پیش‌نمایش ${preview.netProfit} است؛ فروش ۳۰ اسفند (۵۰۰٬۰۰۰) باید در سود ۱٬۵۰۰٬۰۰۰ باشد`);
  }

  let refused = '';
  try {
    await FiscalYearService.getFiscalYearClosingPreview({ year: LEAP_CLOSING_YEAR, closingDate: `${LEAP_CLOSING_YEAR}/12/29` });
  } catch (err) {
    refused = getErrorMessage(err);
  }
  if (!refused.includes('آخرین روز')) problems.push('تاریخ اختتامیه ۲۹ اسفند در سال کبیسه پذیرفته شد');

  try {
    const closed = await FiscalYearService.executeFiscalYearClosing({ year: LEAP_CLOSING_YEAR, createOpeningVoucher: true, username: 'inv' });
    const byRef = new Map(closed.closingVouchers.map(v => [v.referenceNumber, v.date]));
    if (byRef.get(`CLOSE-TEMP-${LEAP_CLOSING_YEAR}`) !== LEAP_LAST_DAY || byRef.get(`CLOSING-${LEAP_CLOSING_YEAR}`) !== LEAP_LAST_DAY) {
      problems.push(`اسناد بستن به تاریخ ${byRef.get(`CLOSE-TEMP-${LEAP_CLOSING_YEAR}`)} / ${byRef.get(`CLOSING-${LEAP_CLOSING_YEAR}`)} صادر شدند؛ انتظار ${LEAP_LAST_DAY}`);
    }
    if (byRef.get(`OPENING-${LEAP_CLOSING_YEAR + 1}`) !== NEXT_FIRST_DAY) {
      problems.push(`سند افتتاحیه به تاریخ ${byRef.get(`OPENING-${LEAP_CLOSING_YEAR + 1}`)} صادر شد؛ انتظار ${NEXT_FIRST_DAY}`);
    }
    const left = await revenueOfYear(revenue.id);
    if (!fin(left).isZero()) problems.push(`پس از بستن سال ${LEAP_CLOSING_YEAR} مانده درآمد ${left} باقی ماند`);
  } catch (err) {
    problems.push(`بستن سال ${LEAP_CLOSING_YEAR} رد شد: ${getErrorMessage(err)}`);
  }
  return problems;
}
