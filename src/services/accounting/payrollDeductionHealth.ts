import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { formatPersianPrice, toPersianDigits } from '../../utils/persianNumber.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.275 (TD-554، B03-12، تصمیم ت۶ الف): تا v9.0.274 کسورات فیش حقوق (بیمه و مالیات سهم کارکنان) به نگاشت پیش‌فرض
 * ۳۲۰۲ می‌رفت که نامش در سرفصل استاندارد «پیش‌دریافت‌ها از مشتریان» است، پس ترازنامه کسورات کارکنان را پیش‌دریافت مشتری
 * نشان می‌داد. از این نسخه پیش‌فرض ۳۲۰۵ «کسورات حقوق پرداختنی» است و سندهای گذشته جابه‌جا نمی‌شوند. این بررسی پرسنلی
 * را فهرست می‌کند که ردیف‌های تفصیلی‌شان روی ۳۲۰۲ هنوز مانده دارد و دست‌کم یک سند فیش در آن هست؛ سند اصلاحی که مانده را
 * با همان تفصیلی پرسنل به حساب کسورات ببرد، او را از فهرست بیرون می‌برد.
 */

/** کد ۳۲۰۲ در سرفصل استاندارد: پیش‌دریافت‌ها از مشتریان */
export const CUSTOMER_PREPAYMENTS_ACCOUNT_CODE = '3202';

export interface PayslipDeductionsInPrepayments {
  personnelId: number;
  personnelName: string;
  /** مانده بستانکار ۳۲۰۲ با تفصیلی این پرسنل (ریال) */
  balance: string;
  /** شماره سندهای فیشی که ۳۲۰۲ را بستانکار کرده‌اند */
  voucherNumbers: string[];
}

export async function findPayslipDeductionsInPrepayments(): Promise<PayslipDeductionsInPrepayments[]> {
  const res = await orm.execute(sql`
    SELECT i.detailed_id AS personnel_id,
           COALESCE(NULLIF(btrim(pe.full_name), ''), MAX(i.detailed_name), '') AS personnel_name,
           SUM(i.credit - i.debit)::text AS balance,
           COALESCE(array_agg(DISTINCT v.voucher_number::text) FILTER (
             WHERE i.credit > 0 AND (v.source_payroll_id IS NOT NULL OR v.voucher_type = 'payroll')), ARRAY[]::text[]) AS voucher_numbers
      FROM journal_voucher_items i
      JOIN journal_vouchers v ON v.id = i.voucher_id AND v.is_deleted = 0
      JOIN accounts a ON a.id = i.account_id AND a.is_deleted = 0 AND a.code = ${CUSTOMER_PREPAYMENTS_ACCOUNT_CODE}
      LEFT JOIN personnel pe ON pe.id = i.detailed_id
     WHERE i.is_deleted = 0 AND i.detailed_type = 'personnel' AND i.detailed_id IS NOT NULL
     GROUP BY i.detailed_id, pe.full_name
    HAVING SUM(i.credit - i.debit) <> 0
       AND bool_or(i.credit > 0 AND (v.source_payroll_id IS NOT NULL OR v.voucher_type = 'payroll'))
     ORDER BY i.detailed_id
     LIMIT 200`);
  return (res.rows as Array<Record<string, unknown>>).map(r => ({
    personnelId: Number(r.personnel_id),
    personnelName: String(r.personnel_name ?? ''),
    balance: fin(String(r.balance ?? '0')).toString(),
    voucherNumbers: Array.isArray(r.voucher_numbers) ? r.voucher_numbers.map(String).sort((a, b) => Number(a) - Number(b)) : [],
  }));
}

export function buildPayslipDeductionsHealthTest(entries: PayslipDeductionsInPrepayments[]): HealthCheckTestResult {
  return {
    id: 'payroll_deductions_in_customer_prepayments',
    category: 'accounts',
    title: 'کسورات فیش حقوق در حساب پیش‌دریافت مشتریان',
    description: 'کسورات فیش حقوق (بیمه و مالیات سهم کارکنان) به حساب «کسورات حقوق پرداختنی» (۳۲۰۵) می‌رود. سندهای پیشین آن را در ۳۲۰۲ «پیش‌دریافت‌ها از مشتریان» گذاشته‌اند و خودکار جابه‌جا نمی‌شوند',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'هیچ کسورات فیش حقوقی در حساب پیش‌دریافت مشتریان نمانده است.'
      : `کسورات فیش ${toPersianDigits(String(entries.length))} نفر از پرسنل در ۳۲۰۲ مانده است. با سند اصلاحی، ۳۲۰۲ را با تفصیلی همان پرسنل بدهکار و «کسورات حقوق پرداختنی» را بستانکار کنید.`,
    items: entries.map(e => ({
      id: e.personnelId,
      code: String(e.personnelId),
      title: e.personnelName || 'پرسنل',
      subtitle: `مانده ۳۲۰۲: ${formatPersianPrice(e.balance, 'IRR', 4)}`,
      details: e.voucherNumbers.length > 0
        ? `سند فیش ${e.voucherNumbers.map(n => toPersianDigits(n)).join('، ')} (TD-554).`
        : 'کسورات فیش حقوق در ۳۲۰۲ (TD-554).',
    })),
    metrics: { payrollDeductionsInCustomerPrepayments: entries.length },
  };
}
