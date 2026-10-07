import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * بسته ۳، PR «ب»: آزمون‌های سلامت مالی بستن سال. داده پیشین بازنویسی نمی‌شود؛ فقط فهرست می‌شود تا حسابدار تصمیم بگیرد.
 */

export interface ManualClosingTypeVoucher {
  id: number;
  voucherNumber: number;
  date: string;
  status: string;
  referenceNumber: string;
  description: string;
  totalDebit: string;
}

/**
 * v9.0.121 (TD-559، B03-17): سند فعال از نوع «اختتامیه» که بستن سال صادر نکرده است (بی پیوند `source_fiscal_year`).
 * فرم سند دستی پیش‌تر «افتتاحیه / اختتامیه» را با این نوع ذخیره می‌کرد؛ این اسناد در گزارش‌ها شمرده می‌شوند و اکنون
 * معکوس و اصلاح هم می‌شوند، ولی نوعشان خودکار عوض نمی‌شود.
 */
export async function findManualClosingTypeVouchers(): Promise<ManualClosingTypeVoucher[]> {
  const res = await orm.execute(sql`
    SELECT id, voucher_number, date, status, COALESCE(reference_number, '') AS reference_number, COALESCE(description, '') AS description,
           total_debit::text AS total_debit
      FROM journal_vouchers
     WHERE is_deleted = 0 AND voucher_type = 'closing' AND source_fiscal_year IS NULL
     ORDER BY date, voucher_number`);
  return (res.rows as Array<Record<string, unknown>>).map(r => ({
    id: Number(r.id),
    voucherNumber: Number(r.voucher_number),
    date: String(r.date ?? '').slice(0, 10),
    status: String(r.status ?? ''),
    referenceNumber: String(r.reference_number ?? ''),
    description: String(r.description ?? ''),
    totalDebit: String(r.total_debit ?? '0'),
  }));
}

export function buildManualClosingTypeHealthTest(entries: ManualClosingTypeVoucher[]): HealthCheckTestResult {
  return {
    id: 'manual_closing_type_vouchers',
    category: 'vouchers',
    title: 'اسناد دستی با نوع «اختتامیه»',
    description: 'سند اختتامیه را فقط بستن سال مالی صادر می‌کند. پیش از نسخه ۹.۰.۱۲۱ فرم سند دستی گزینه «افتتاحیه / اختتامیه» را با نوع اختتامیه ذخیره می‌کرد؛ این اسناد مانند سند عادی در گزارش‌ها شمرده می‌شوند و نوعشان خودکار عوض نمی‌شود',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'هیچ سند دستی‌ای نوع اختتامیه ندارد.'
      : `${entries.length} سند دستی نوع اختتامیه دارد؛ مانند سند عادی در گزارش‌ها شمرده می‌شود و معکوس و اصلاح هم می‌شود.`,
    quickFixAction: entries.length > 0 ? 'open_vouchers' : undefined,
    items: entries.map(e => ({
      id: e.id,
      code: `سند حسابداری #${e.voucherNumber}`,
      title: e.description || 'سند دستی',
      subtitle: `تاریخ: ${isoToJalaliDate(e.date) || e.date}${e.referenceNumber ? ` | مرجع: ${e.referenceNumber}` : ''}`,
      amount: fin(e.totalDebit).toNumber(),
      date: e.date,
      linkType: 'voucher' as const,
      linkId: e.id,
      details: 'نوع اختتامیه دارد ولی بستن سال آن را صادر نکرده است (TD-559).',
    })),
    metrics: { manualClosingTypeVouchers: entries.length },
  };
}
