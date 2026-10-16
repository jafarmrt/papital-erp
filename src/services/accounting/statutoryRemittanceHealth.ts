import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { formatPersianPrice, toPersianDigits } from '../../utils/persianNumber.js';
import type { Account, HealthCheckTestResult } from '../../types.js';
import { AccountMappingService } from './accountMapping.service.js';

/**
 * v10.1.36 (TD-1243، تصمیم ت۳۳ الف): سند فیش بیمه (۳۲۰۴) و مالیات حقوق (۳۲۰۶) را با تفصیلی هر پرسنل بستانکار می‌کند.
 * پرداخت به تأمین اجتماعی یا امور مالیاتی از «پرداخت به تأمین اجتماعی» و «پرداخت به امور مالیاتی» هر نفر را با تفصیلی
 * خودش بدهکار می‌کند؛ پرداختی که پیش‌تر با فرم خزانه («متفرقه» با طرف حساب ۳۲۰۴ یا ۳۲۰۶) ثبت شده، تفصیلی پرسنل ندارد و
 * مانده هر نفر را باز می‌گذارد. این بررسی سندهای زنده‌ای را فهرست می‌کند که روی این دو حساب بی تفصیلی پرسنل بدهکار
 * مانده‌اند (سند معکوس و سندی که معکوس زنده دارد شمرده نمی‌شود)، تا حسابدار با سند اصلاحی به نام هر نفر ببرد. هیچ ردیف
 * قدیمی خودکار عوض نمی‌شود. فقط حسابی فهرست می‌شود که بدهکار خالص ردیف‌های بی تفصیلی پرسنل کل آن هنوز مثبت است؛ سند اصلاحی
 * (بدهکار با تفصیلی هر نفر، بستانکار بی تفصیلی) آن را صفر و بررسی را پاک می‌کند. پنجره پرداخت فهرست
 * (`statutoryRemittanceOptions.ts`) همین قاعده را برای «بررسی کردم» می‌خواند.
 */

export interface StatutoryPaymentWithoutPersonnel {
  voucherId: number;
  voucherNumber: string;
  date: string;
  accountCode: string;
  accountName: string;
  /** بدهکار خالص حساب در این سند بی تفصیلی پرسنل (ریال) */
  amount: string;
}

export async function findStatutoryPaymentsWithoutPersonnel(): Promise<StatutoryPaymentWithoutPersonnel[]> {
  const accounts = [await AccountMappingService.getInsurancePayableAccount(), await AccountMappingService.getPayrollTaxPayableAccount()]
    .filter((a): a is Account => Boolean(a));
  if (accounts.length === 0) return [];
  const noPersonnel = sql`(i.detailed_type IS DISTINCT FROM 'personnel' OR i.detailed_id IS NULL)`;
  const net = await orm.execute(sql`
    SELECT i.account_id FROM journal_voucher_items i
      JOIN journal_vouchers v ON v.id = i.voucher_id AND v.is_deleted = 0
     WHERE i.is_deleted = 0 AND i.account_id IN (${sql.join(accounts.map(a => sql`${a.id}`), sql`, `)}) AND ${noPersonnel}
     GROUP BY i.account_id
    HAVING SUM(i.debit - i.credit) > 0`);
  const open = (net.rows as Array<{ account_id: unknown }>).map(r => Number(r.account_id));
  if (open.length === 0) return [];
  const res = await orm.execute(sql`
    SELECT v.id AS voucher_id, v.voucher_number::text AS voucher_number, v.date, a.code AS account_code, a.name AS account_name,
           SUM(i.debit - i.credit)::text AS amount
      FROM journal_voucher_items i
      JOIN journal_vouchers v ON v.id = i.voucher_id AND v.is_deleted = 0
      JOIN accounts a ON a.id = i.account_id
     WHERE i.is_deleted = 0
       AND i.account_id IN (${sql.join(open.map(id => sql`${id}`), sql`, `)})
       AND ${noPersonnel}
       AND COALESCE(v.reference_number, '') NOT LIKE 'REV-V%'
       AND COALESCE(v.reference_number, '') NOT LIKE 'VOID-REPOST-V%'
       AND NOT EXISTS (
         SELECT 1 FROM journal_vouchers r
          WHERE r.is_deleted = 0 AND r.reference_id = v.id
            AND r.reference_number IN ('REV-V' || v.voucher_number::text, 'VOID-REPOST-V' || v.voucher_number::text))
     GROUP BY v.id, v.voucher_number, v.date, a.code, a.name
    HAVING SUM(i.debit - i.credit) > 0
     ORDER BY v.date, v.id
     LIMIT 200`);
  return (res.rows as Array<Record<string, unknown>>).map(r => ({
    voucherId: Number(r.voucher_id),
    voucherNumber: String(r.voucher_number ?? ''),
    date: String(r.date ?? ''),
    accountCode: String(r.account_code ?? ''),
    accountName: String(r.account_name ?? ''),
    amount: fin(String(r.amount ?? '0')).toString(),
  }));
}

export function buildStatutoryPaymentsHealthTest(entries: StatutoryPaymentWithoutPersonnel[]): HealthCheckTestResult {
  return {
    id: 'statutory_payments_without_personnel',
    category: 'accounts',
    title: 'پرداخت بیمه و مالیات حقوق بی نام پرسنل',
    description: 'فیش حقوق بیمه و مالیات حقوق را به نام هر نفر می‌گذارد. پرداختی که بی نام پرسنل به «بیمه پرداختنی» یا «مالیات حقوق پرداختنی» زده شده، مانده هر نفر را باز می‌گذارد. پرداخت تازه را از «فهرست بیمه و مالیات ماهانه» ثبت کنید',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'همه پرداخت‌های بیمه و مالیات حقوق به نام پرسنل ثبت شده است.'
      : `${toPersianDigits(String(entries.length))} سند پرداخت بیمه یا مالیات حقوق بی نام پرسنل است. مبلغ هر سند را با سند اصلاحی (بدهکار همان حساب با تفصیلی هر نفر و بستانکار همان حساب بی تفصیلی) به نام پرسنل ببرید.`,
    items: entries.map(e => ({
      id: e.voucherId,
      code: toPersianDigits(e.voucherNumber),
      title: `سند ${toPersianDigits(e.voucherNumber)}، ${e.accountName}`,
      subtitle: `بدهکار بی نام پرسنل: ${formatPersianPrice(e.amount, 'IRR', 4)}`,
      details: `حساب ${toPersianDigits(e.accountCode)} (TD-1243).`,
    })),
    metrics: { statutoryPaymentsWithoutPersonnel: entries.length },
  };
}
