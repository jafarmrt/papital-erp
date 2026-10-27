import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import type { HealthCheckTestResult } from '../../types.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { formatPersianNumber, formatPersianPrice } from '../../utils/persianNumber.js';

/**
 * The voucher balance health check (`vouchers_balance`). A single-currency voucher is checked on its raw amounts and a
 * mixed-currency voucher in rial by the TD-260 rule (each foreign row × its own rate, rounded to the rial) (v9.0.190,
 * TD-551, ت۷).
 *
 * v11 phase 6.1j (M8): debit and credit are compared exactly. A voucher is saved when the two differ by no more than
 * `VOUCHER_BALANCE_TOLERANCE` (0.01), so a fractional rial (Dr 100.004 / Cr 100) passed every path and the trial
 * balance did not tie, while this check said every voucher was balanced. Such a voucher is now listed as a warning
 * (a small difference); a difference over the tolerance stays an error, as before.
 */
export interface VoucherBalanceDifference {
  id: number;
  voucherNumber: number;
  date: string;
  description: string;
  debit: string;
  credit: string;
  difference: string;
  /** more than VOUCHER_BALANCE_TOLERANCE: no save path accepts it */
  overTolerance: boolean;
}

export interface VoucherBalanceDifferences {
  rows: VoucherBalanceDifference[];
  /** every voucher over the tolerance, beyond the listed rows */
  overToleranceCount: number;
  /** every voucher with a difference within the tolerance */
  smallCount: number;
}

const LISTED_VOUCHERS = 50;

export async function findVoucherBalanceDifferences(): Promise<VoucherBalanceDifferences> {
  const tolerance = sql.raw(String(VOUCHER_BALANCE_TOLERANCE));
  const res = await orm.execute(sql`
    WITH rows AS (
      SELECT vi.voucher_id, vi.debit, vi.credit,
             UPPER(COALESCE(NULLIF(vi.currency, ''), NULLIF(v.currency, ''), 'IRR')) AS cur,
             COALESCE(NULLIF(vi.exchange_rate, 0), 1) AS rate
        FROM journal_voucher_items vi
        JOIN journal_vouchers v ON v.id = vi.voucher_id
       -- v8.0.15 (TD-270): soft-deleted rows (a draft synced again) count in no check
       WHERE vi.is_deleted = 0
    ), sums AS (
      SELECT voucher_id,
             COUNT(DISTINCT cur) AS currency_count,
             SUM(debit) AS raw_debit, SUM(credit) AS raw_credit,
             SUM(CASE WHEN cur = 'IRR' THEN debit ELSE ROUND(debit * rate, 0) END) AS irr_debit,
             SUM(CASE WHEN cur = 'IRR' THEN credit ELSE ROUND(credit * rate, 0) END) AS irr_credit
        FROM rows GROUP BY voucher_id
    ), checked AS (
      SELECT v.id, v.voucher_number, v.date, v.description,
             COALESCE(CASE WHEN s.currency_count > 1 THEN s.irr_debit ELSE s.raw_debit END, 0) AS calc_debit,
             COALESCE(CASE WHEN s.currency_count > 1 THEN s.irr_credit ELSE s.raw_credit END, 0) AS calc_credit
        FROM journal_vouchers v
        LEFT JOIN sums s ON s.voucher_id = v.id
       WHERE v.is_deleted = 0
    ), differing AS (
      SELECT *, ABS(calc_debit - calc_credit) AS difference, ABS(calc_debit - calc_credit) > ${tolerance} AS over_tolerance
        FROM checked
       WHERE calc_debit <> calc_credit
    )
    SELECT id, voucher_number, date::text AS date, COALESCE(description, '') AS description,
           calc_debit::text AS debit, calc_credit::text AS credit, difference::text AS difference, over_tolerance,
           COUNT(*) FILTER (WHERE over_tolerance) OVER ()::int AS over_count,
           COUNT(*) FILTER (WHERE NOT over_tolerance) OVER ()::int AS small_count
      FROM differing
     ORDER BY over_tolerance DESC, voucher_number DESC
     LIMIT ${LISTED_VOUCHERS}`);
  const raw = (res.rows ?? []) as Array<Record<string, unknown>>;
  return {
    rows: raw.map(r => ({
      id: Number(r.id),
      voucherNumber: Number(r.voucher_number),
      date: String(r.date ?? '').slice(0, 10),
      description: String(r.description ?? ''),
      debit: String(r.debit ?? '0'),
      credit: String(r.credit ?? '0'),
      difference: String(r.difference ?? '0'),
      overTolerance: r.over_tolerance === true,
    })),
    overToleranceCount: Number(raw[0]?.over_count ?? 0),
    smallCount: Number(raw[0]?.small_count ?? 0),
  };
}

const TITLE = 'تراز و تعادل اسناد دوبل حسابداری';
const DESCRIPTION = 'بررسی برابری دقیق جمع بدهکار و بستانکار هر سند؛ اختلاف بیش از ۰٫۰۱ خطاست و اختلاف کوچک‌تر (کسر ریال) هشدار، '
  + 'چون تراز آزمایشی را هم ناتراز می‌کند';

export function buildVoucherBalanceHealthTest(found: VoucherBalanceDifferences, totalVouchers: number): HealthCheckTestResult {
  const { rows, overToleranceCount, smallCount } = found;
  const metrics = { totalVouchersChecked: totalVouchers, unbalancedCount: overToleranceCount, smallDifferenceCount: smallCount };
  if (rows.length === 0) {
    return {
      id: 'vouchers_balance', category: 'vouchers', title: TITLE, description: DESCRIPTION, status: 'healthy', scoreImpact: 0, count: 0,
      message: 'جمع بدهکار و بستانکار همه اسناد ثبت‌شده دقیقاً برابر است.',
      metrics,
    };
  }
  const penalty = overToleranceCount > 0 ? Math.min(40, overToleranceCount * 20) : Math.min(10, smallCount * 2);
  const parts: string[] = [];
  if (overToleranceCount > 0) parts.push(`${formatPersianNumber(overToleranceCount, 0)} سند حسابداری با مغایرت ریالی بین بدهکار و بستانکار شناسایی شد!`);
  if (smallCount > 0) {
    parts.push(`${formatPersianNumber(smallCount, 0)} سند اختلاف کوچکی (کسر ریال، تا ۰٫۰۱) بین بدهکار و بستانکار دارد که ذخیره پذیرفته است، `
      + 'ولی تراز آزمایشی و ترازنامه را ناتراز می‌کند.');
  }
  return {
    id: 'vouchers_balance',
    category: 'vouchers',
    title: TITLE,
    description: DESCRIPTION,
    status: overToleranceCount > 0 ? 'error' : 'warning',
    scoreImpact: -penalty,
    count: overToleranceCount + smallCount,
    message: parts.join(' '),
    quickFixHint: overToleranceCount > 0
      ? 'اصلاح آرتیکل‌ها در ویرایش سند جهت برقراری تعادل'
      : 'اختلاف را با سند اصلاحی (ردیف گرد کردن) به صفر برسانید',
    quickFixAction: 'open_vouchers',
    items: rows.map(r => {
      const difference = Number(r.difference);
      return {
        id: r.id,
        code: `سند #${r.voucherNumber}`,
        title: r.description || `سند شماره ${r.voucherNumber}`,
        subtitle: `تاریخ: ${isoToJalaliDate(r.date) || r.date} — بدهکار: ${formatPersianPrice(r.debit, undefined, 4)} | بستانکار: ${formatPersianPrice(r.credit, undefined, 4)}`,
        amount: difference,
        discrepancy: difference,
        date: r.date,
        details: r.overTolerance
          ? `اختلاف ناترازی: ${formatPersianPrice(r.difference, undefined, 4)}`
          : `اختلاف کوچک: ${formatPersianPrice(r.difference, undefined, 4)} (در حد مجاز ذخیره، ولی تراز را به هم می‌زند)`,
        linkType: 'voucher' as const,
        linkId: r.id,
      };
    }),
    metrics,
  };
}
