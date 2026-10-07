import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { HealthCheckTestResult } from '../../types.js';
import { AccountMappingService } from '../accounting/accountMapping.service.js';

/**
 * v9.0.231 (TD-804، B12P-01، تصمیم ت۱ الف): فیش زنده‌ای که با سند حسابداری‌اش نمی‌خواند (ناوردایی I10). تا این نسخه پاداش و
 * کسورات منفی پذیرفته می‌شد: سند کسورات منفی را صفر می‌گرفت، پس بستانکار «حقوق و دستمزد پرداختنی» از خالص فیش کمتر بود، و
 * فیش با ناخالص صفر بی سند صادر و پرداخت می‌شد. این فیش‌ها خودکار بازنویسی نمی‌شوند؛ فهرست می‌شوند تا حسابدار تصمیم بگیرد.
 */

export type PayrollVoucherIssue = 'negative_component' | 'no_voucher' | 'payable_mismatch';

export interface PayrollVoucherMismatch {
  id: number;
  payrollNumber: string;
  title: string;
  personnelName: string;
  endDate: string;
  netPayable: string;
  voucherId: number | null;
  voucherNumber: number | null;
  /** بستانکار خالص «حقوق و دستمزد پرداختنی» سند برای همین پرسنل */
  payableCredit: string | null;
  issues: PayrollVoucherIssue[];
}

export async function findPayrollVoucherMismatches(): Promise<PayrollVoucherMismatch[]> {
  const payable = await AccountMappingService.getWagesPayableAccount();
  const payableId = payable?.id ?? 0;
  const res = await orm.execute(sql`
    SELECT p.id, p.payroll_number, COALESCE(p.title, '') AS title, COALESCE(pe.full_name, '') AS personnel_name, p.end_date,
           COALESCE(p.net_payable, 0)::text AS net_payable,
           (COALESCE(p.total_bonuses, 0) < 0 OR COALESCE(p.total_deductions, 0) < 0 OR COALESCE(p.advance_deduction, 0) < 0) AS negative,
           v.id AS voucher_id, v.voucher_number,
           (SELECT COALESCE(SUM(i.credit - i.debit), 0) FROM journal_voucher_items i
             WHERE i.voucher_id = v.id AND i.is_deleted = 0 AND i.account_id = ${payableId}
               AND i.detailed_type = 'personnel' AND i.detailed_id = p.personnel_id)::text AS payable_credit
      FROM piecework_payrolls p
      LEFT JOIN personnel pe ON pe.id = p.personnel_id
      LEFT JOIN LATERAL (
        SELECT jv.id, jv.voucher_number FROM journal_vouchers jv
         WHERE jv.is_deleted = 0
           AND (jv.source_payroll_id = p.id
                OR (jv.source_payroll_id IS NULL AND jv.voucher_type = 'payroll' AND jv.reference_module = 'payroll'
                    AND jv.reference_id = p.id AND jv.reference_number = btrim(p.payroll_number)))
         ORDER BY (jv.source_payroll_id IS NOT NULL) DESC, jv.id
         LIMIT 1
      ) v ON true
     WHERE p.is_deleted = 0
     ORDER BY p.id`);
  const out: PayrollVoucherMismatch[] = [];
  for (const r of res.rows as Array<Record<string, unknown>>) {
    const net = fin(String(r.net_payable ?? '0'));
    const voucherId = r.voucher_id === null || r.voucher_id === undefined ? null : Number(r.voucher_id);
    const payableCredit = voucherId === null ? null : fin(String(r.payable_credit ?? '0'));
    const issues: PayrollVoucherIssue[] = [];
    if (r.negative === true) issues.push('negative_component');
    if (voucherId === null && net.isPositive()) issues.push('no_voucher');
    if (payable && payableCredit !== null && payableCredit.subtract(net).abs().greaterThan(VOUCHER_BALANCE_TOLERANCE)) issues.push('payable_mismatch');
    if (issues.length === 0) continue;
    out.push({
      id: Number(r.id),
      payrollNumber: String(r.payroll_number ?? ''),
      title: String(r.title ?? ''),
      personnelName: String(r.personnel_name ?? ''),
      endDate: String(r.end_date ?? ''),
      netPayable: net.toString(),
      voucherId,
      voucherNumber: r.voucher_number === null || r.voucher_number === undefined ? null : Number(r.voucher_number),
      payableCredit: payableCredit?.toString() ?? null,
      issues,
    });
  }
  return out;
}

const ISSUE_TEXT: Record<PayrollVoucherIssue, string> = {
  negative_component: 'پاداش، کسورات یا کسر مساعده منفی',
  no_voucher: 'خالص مثبت بی سند حسابداری',
  payable_mismatch: 'بستانکار حقوق پرداختنی سند با خالص فیش نمی‌خواند',
};

export function buildPayrollVoucherHealthTest(entries: PayrollVoucherMismatch[]): HealthCheckTestResult {
  return {
    id: 'payroll_voucher_mismatch',
    category: 'vouchers',
    title: 'فیش حقوقی ناهمخوان با سند حسابداری',
    description: 'خالص هر فیش زنده باید با بستانکار «حقوق و دستمزد پرداختنی» سندش برابر باشد. پیش از نسخه ۹.۰.۲۳۱ پاداش و کسورات منفی پذیرفته می‌شد و فیش با ناخالص صفر بی سند صادر می‌شد؛ این فیش‌ها خودکار عوض نمی‌شوند',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'خالص همه فیش‌های حقوقی با سند حسابداری آن‌ها می‌خواند.'
      : `${toPersianDigits(String(entries.length))} فیش حقوقی با سند حسابداری خود نمی‌خواند؛ فیش پرداخت‌نشده را باطل و دوباره صادر کنید و برای فیش پرداخت‌شده سند اصلاحی ثبت کنید.`,
    quickFixAction: entries.length > 0 ? 'open_vouchers' : undefined,
    items: entries.map(e => ({
      id: e.id,
      code: `فیش ${e.payrollNumber}`,
      title: e.title || `فیش ${e.payrollNumber}`,
      subtitle: `${e.personnelName} | پایان دوره: ${isoToJalaliDate(e.endDate) || e.endDate}${e.voucherNumber !== null ? ` | سند #${toPersianDigits(String(e.voucherNumber))}` : ''}`,
      amount: fin(e.netPayable).toNumber(),
      date: e.endDate,
      ...(e.voucherId !== null ? { linkType: 'voucher' as const, linkId: e.voucherId } : {}),
      details: `${e.issues.map(i => ISSUE_TEXT[i]).join('؛ ')} (TD-804).`,
    })),
    metrics: { payrollVoucherMismatches: entries.length },
  };
}
