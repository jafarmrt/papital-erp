import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.169 (TD-551، B03-09، تصمیم ت۷ الف): سند فعالی که ردیف غیرریالی بی نرخ واقعی دارد (نرخ خالی، صفر یا ۱).
 * تا این نسخه سند دستی ارز بی نرخ را با نرخ ۱ ذخیره می‌کرد و گزارش‌های ریالی ۱۰۰ دلار را ۱۰۰ ریال می‌شمردند.
 * ردیف‌ها خودکار بازنویسی نمی‌شوند؛ فهرست می‌شوند تا حسابدار سند را اصلاح کند.
 */

export interface VoucherWithoutForeignRate {
  id: number;
  voucherNumber: number;
  date: string;
  status: string;
  description: string;
  /** شماره ردیف‌های بی نرخ در سند */
  rows: number[];
  currencies: string[];
}

export async function findVouchersWithoutForeignRate(): Promise<VoucherWithoutForeignRate[]> {
  const res = await orm.execute(sql`
    SELECT v.id, v.voucher_number, v.date, v.status, COALESCE(v.description, '') AS description,
           ARRAY_AGG(vi.row_order ORDER BY vi.row_order) AS row_orders,
           ARRAY_AGG(DISTINCT UPPER(COALESCE(NULLIF(vi.currency, ''), NULLIF(v.currency, ''), 'IRR'))) AS currencies
      FROM journal_vouchers v
      JOIN journal_voucher_items vi ON vi.voucher_id = v.id AND vi.is_deleted = 0
     WHERE v.is_deleted = 0
       AND UPPER(COALESCE(NULLIF(vi.currency, ''), NULLIF(v.currency, ''), 'IRR')) <> 'IRR'
       AND COALESCE(vi.exchange_rate, 0) IN (0, 1)
     GROUP BY v.id, v.voucher_number, v.date, v.status, v.description
     ORDER BY v.date, v.voucher_number
     LIMIT 200`);
  return (res.rows as Array<Record<string, unknown>>).map(r => ({
    id: Number(r.id),
    voucherNumber: Number(r.voucher_number),
    date: String(r.date ?? '').slice(0, 10),
    status: String(r.status ?? ''),
    description: String(r.description ?? ''),
    rows: (Array.isArray(r.row_orders) ? r.row_orders : []).map(Number),
    currencies: (Array.isArray(r.currencies) ? r.currencies : []).map(String),
  }));
}

export function buildForeignRateHealthTest(entries: VoucherWithoutForeignRate[]): HealthCheckTestResult {
  return {
    id: 'voucher_foreign_rows_without_rate',
    category: 'vouchers',
    title: 'ردیف ارزی بی نرخ تبدیل در اسناد حسابداری',
    description: 'هر ردیف غیرریالی سند نرخ تبدیل مثبت لازم دارد. پیش از نسخه ۹.۰.۱۵۳ سند دستی ارز بی نرخ را با نرخ ۱ ذخیره می‌کرد و گزارش‌های ریالی مبلغ ارزی را همان مبلغ به ریال می‌شمردند؛ این ردیف‌ها خودکار عوض نمی‌شوند',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'همه ردیف‌های ارزی اسناد نرخ تبدیل دارند.'
      : `${toPersianDigits(String(entries.length))} سند ردیف ارزی با نرخ خالی، صفر یا ۱ دارد؛ گزارش‌های ریالی این ردیف‌ها را با نرخ ۱ می‌شمرند. سند را با «سند اصلاحی» و نرخ درست اصلاح کنید.`,
    quickFixAction: entries.length > 0 ? 'open_vouchers' : undefined,
    items: entries.map(e => ({
      id: e.id,
      code: `سند حسابداری #${e.voucherNumber}`,
      title: e.description || `سند شماره ${e.voucherNumber}`,
      subtitle: `تاریخ: ${isoToJalaliDate(e.date) || e.date} | ارز: ${e.currencies.join('، ')}`,
      date: e.date,
      linkType: 'voucher' as const,
      linkId: e.id,
      details: `ردیف ${toPersianDigits(e.rows.join('، '))} نرخ تبدیل ندارد (TD-551).`,
    })),
    metrics: { vouchersWithoutForeignRate: entries.length },
  };
}
