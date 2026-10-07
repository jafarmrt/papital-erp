import { asc, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { fiscalPeriods } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { getDisplayTimezone } from '../../lib/businessClock.js';
import { zonedDayStartUtc } from '../../lib/serverTimestamp.js';
import { isoToJalaliDate, jalaliYearBounds } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { earliestVoucherYear, fiscalYearsWithVouchers } from './fiscalYearOrder.js';
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
 * v9.0.160 (TD-559، B03-17): سند فعال از نوع «اختتامیه» که بستن سال صادر نکرده است (بی پیوند `source_fiscal_year`).
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
    id: 'manual_vouchers_closing_type',
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

export interface EarlyClosedYear {
  year: number;
  /** زمان سرور UTC (`YYYY-MM-DD HH:MM:SS`) */
  closedAt: string;
  closedBy: string;
  /** نخستین روز سال بعد (ISO): سال از این روز تمام است */
  endsOn: string;
}

/** زمان سرور بی‌منطقه به شکل قابل مقایسه `YYYY-MM-DD HH:MM:SS` */
function serverTimestampKey(value: string): string {
  return value.trim().replace('T', ' ').slice(0, 19);
}

/**
 * v9.0.161 (TD-543، B03-01، تصمیم ت۱): سال‌هایی که پیش از پایانشان بسته شده‌اند (زمان بستن پیش از آغاز نخستین روز سال بعد
 * در منطقه زمانی کسب‌وکار). بستن چنین سالی اکنون رد می‌شود؛ بستن‌های پیشین فقط فهرست می‌شوند. سال بسته بی زمان بستن
 * (ردیف قدیمی) سنجیده نمی‌شود.
 */
export async function findEarlyClosedYears(): Promise<EarlyClosedYear[]> {
  const timeZone = await getDisplayTimezone();
  const rows = await orm.select().from(fiscalPeriods).where(eq(fiscalPeriods.status, 'closed')).orderBy(asc(fiscalPeriods.fiscalYear));
  const early: EarlyClosedYear[] = [];
  for (const r of rows) {
    const bounds = jalaliYearBounds(r.fiscalYear);
    if (!r.closedAt || !bounds) continue;
    if (serverTimestampKey(r.closedAt) < zonedDayStartUtc(bounds.nextFirstDay, timeZone)) {
      early.push({ year: r.fiscalYear, closedAt: serverTimestampKey(r.closedAt), closedBy: r.closedBy ?? '', endsOn: bounds.nextFirstDay });
    }
  }
  return early;
}

export function buildEarlyClosedYearsHealthTest(entries: EarlyClosedYear[]): HealthCheckTestResult {
  return {
    id: 'fiscal_year_closed_early',
    category: 'vouchers',
    title: 'سال مالی بسته‌شده پیش از پایان',
    description: 'سال مالی فقط پس از آخرین روزش بسته می‌شود. پیش از نسخه ۹.۰.۱۲۲ سال جاری و حتی سال آینده هم بسته می‌شد و از آن لحظه هیچ سندی با تاریخ امروز ثبت نمی‌شد؛ آخرین سال بسته با «بازگشایی سال مالی» باز می‌شود',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'هیچ سال مالی‌ای پیش از پایانش بسته نشده است.'
      : `${toPersianDigits(entries.length)} سال مالی پیش از پایانش بسته شده است.`,
    items: entries.map(e => ({
      id: e.year,
      code: `سال مالی ${toPersianDigits(e.year)}`,
      title: 'بسته‌شده پیش از پایان سال',
      subtitle: `بسته شده در ${toPersianDigits(isoToJalaliDate(e.closedAt.slice(0, 10)))} (به وقت جهانی)${e.closedBy ? ` توسط ${e.closedBy}` : ''}؛ سال از ${toPersianDigits(isoToJalaliDate(e.endsOn))} تمام است`,
      date: e.closedAt.slice(0, 10),
      details: 'بستن پیش از پایان سال (TD-543).',
    })),
    metrics: { earlyClosedYears: entries.length },
  };
}

export interface OutOfOrderClosedYear {
  year: number;
  /** سال‌های پیشینِ دارای سند که هنوز بازند یا پس از این سال بسته شده‌اند */
  earlierYears: number[];
}

/**
 * v9.0.162 (TD-544، B03-02، تصمیم ت۱): سال‌های بسته‌ای که پیش از سال‌های پیشینِ دارای سند خود بسته شده‌اند (سال پیشین هنوز باز
 * است یا دیرتر بسته شده). بستن بی ترتیب اکنون رد می‌شود؛ بستن‌های پیشین فقط فهرست می‌شوند.
 */
export async function findOutOfOrderClosedYears(): Promise<OutOfOrderClosedYear[]> {
  const periods = await orm.select().from(fiscalPeriods).orderBy(asc(fiscalPeriods.fiscalYear));
  const closed = periods.filter(p => p.status === 'closed');
  if (closed.length === 0) return [];
  const first = await earliestVoucherYear();
  if (first === null) return [];
  const lastClosed = closed[closed.length - 1].fiscalYear;
  const withVouchers = await fiscalYearsWithVouchers(orm, first, lastClosed - 1);
  const periodOf = new Map(periods.map(p => [p.fiscalYear, p]));
  const result: OutOfOrderClosedYear[] = [];
  for (const c of closed) {
    const earlierYears = [...withVouchers].filter(x => {
      if (x >= c.fiscalYear) return false;
      const p = periodOf.get(x);
      if (p?.status !== 'closed') return true;
      return Boolean(p.closedAt && c.closedAt && serverTimestampKey(p.closedAt) > serverTimestampKey(c.closedAt));
    }).sort((a, b) => a - b);
    if (earlierYears.length > 0) result.push({ year: c.fiscalYear, earlierYears });
  }
  return result;
}

export function buildOutOfOrderClosedYearsHealthTest(entries: OutOfOrderClosedYear[]): HealthCheckTestResult {
  return {
    id: 'fiscal_year_closed_out_of_order',
    category: 'vouchers',
    title: 'سال مالی بسته‌شده بی ترتیب',
    description: 'سال‌ها به ترتیب بسته می‌شوند. پیش از نسخه ۹.۰.۱۲۳ سالی بسته می‌شد در حالی که سال پیشینِ دارای سند هنوز باز بود؛ درآمد و هزینه آن سال پیشین هم در بستن این سال می‌آمد. این سال‌ها خودکار اصلاح نمی‌شوند',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'هیچ سال مالی‌ای پیش از سال‌های پیشینِ دارای سند خود بسته نشده است.'
      : `${toPersianDigits(entries.length)} سال مالی پیش از سال‌های پیشینِ دارای سند خود بسته شده است.`,
    items: entries.map(e => ({
      id: e.year,
      code: `سال مالی ${toPersianDigits(e.year)}`,
      title: 'بسته‌شده پیش از سال‌های پیشین',
      subtitle: `سال‌های پیشینِ دارای سند که باز ماندند یا دیرتر بسته شدند: ${e.earlierYears.map(y => toPersianDigits(y)).join('، ')}`,
      details: 'بستن بی ترتیب (TD-544).',
    })),
    metrics: { outOfOrderClosedYears: entries.length },
  };
}
