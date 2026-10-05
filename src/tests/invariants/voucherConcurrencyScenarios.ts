import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { outcomeProblems, raceBehindRowLock } from './concurrencyHarness.js';

/**
 * v8.0.48 — سناریوهای سخت‌گیرانه سند حسابداری حوزه J برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

async function accountIdByCode(code: string): Promise<number> {
  const [row] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, code), eq(accounts.isDeleted, 0)));
  if (!row) throw new Error(`حساب ${code} در کدینگ آزمون نیست`);
  return row.id;
}

async function voucherLines(amount: number) {
  return [
    { accountId: await accountIdByCode('1001'), debit: amount, credit: 0 },
    { accountId: await accountIdByCode('4001'), debit: 0, credit: amount },
  ];
}

async function approvedVoucher(description: string): Promise<number> {
  const voucher = await VoucherService.createJournalVoucher({
    date: '2026-04-01', status: 'approved', description, items: await voucherLines(1000000),
  });
  return voucher.id;
}

/** اسناد برگشتِ فعال یک سند: ابطال (REV-V…) یا ابطال برای بازثبت (VOID-REPOST-V…) */
async function activeReversals(voucherId: number): Promise<number> {
  const res = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM journal_vouchers r JOIN journal_vouchers o ON o.id = r.reference_id
      WHERE o.id = $1 AND r.is_deleted = 0
        AND r.reference_number IN ('REV-V' || o.voucher_number, 'VOID-REPOST-V' || o.voucher_number)`, [voucherId]);
  return res.rows[0]?.n ?? 0;
}

/**
 * TD-321: هر سند حسابداری فقط یک بار برگشت می‌خورد. پیش‌تر دو «سند اصلاحی» هم‌زمان، یا اصلاح و ابطال هم‌زمان، هر دو
 * پذیرفته می‌شدند (اصلاح سند مبدأ را قفل نمی‌کرد)، و «ابطال و بازثبت» پس از ابطال یا پیش از اصلاح، حتی پشت هم، سند را دو
 * بار برمی‌گرداند (هر مسیر فقط پیشوند خودش را می‌سنجید).
 */
export async function checkVoucherReversedOnce(): Promise<string[]> {
  const correction = async (voucherId: number) => VoucherService.correctVoucher({
    voucherId, reason: 'اصلاح مبلغ', date: '2026-04-02', newItems: await voucherLines(900000),
  });
  const repost = async (voucherId: number) => VoucherService.repostVoucher({
    voucherId, reason: 'بازثبت', date: '2026-04-02', newItems: await voucherLines(900000),
  });
  const reverse = (voucherId: number) => VoucherService.reverseVoucher({ voucherId, date: '2026-04-02', reason: 'ابطال' });

  const raced = await approvedVoucher('سند آزمون اصلاح هم‌زمان');
  const labels = ['اصلاح اول', 'اصلاح دوم', 'ابطال'];
  const outcomes = await raceBehindRowLock<unknown>('journal_vouchers', [raced], [() => correction(raced), () => correction(raced), () => reverse(raced)]);
  const problems = outcomeProblems(labels, outcomes, (_label, message) => message.includes('قبلاً'));
  const accepted = outcomes.filter(o => o.status === 'fulfilled').length;
  if (accepted !== 1) problems.push(`از دو اصلاح و یک ابطال هم‌زمان ${accepted} پذیرفته شد، نه یکی`);
  const racedReversals = await activeReversals(raced);
  if (racedReversals !== 1) problems.push(`سند پس از اصلاح و ابطال هم‌زمان ${racedReversals} سند برگشت فعال دارد، نه یکی`);

  const sequences: Array<[(id: number) => Promise<unknown>, (id: number) => Promise<unknown>, string]> = [
    [reverse, repost, 'ابطال سپس ابطال و بازثبت'],
    [repost, correction, 'ابطال و بازثبت سپس اصلاح'],
  ];
  for (const [first, second, label] of sequences) {
    const voucherId = await approvedVoucher(`سند آزمون ${label}`);
    await first(voucherId);
    let refused = '';
    try {
      await second(voucherId);
    } catch (err) {
      refused = getErrorMessage(err);
    }
    if (!refused.includes('قبلاً')) problems.push(`${label}: برگشت دوم رد نشد (${refused || 'پذیرفته شد'})`);
    const count = await activeReversals(voucherId);
    if (count !== 1) problems.push(`${label}: ${count} سند برگشت فعال، نه یکی`);
  }
  return problems;
}
