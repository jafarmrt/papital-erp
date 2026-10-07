import { asc, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { fiscalPeriods } from '../../db/schema.js';
import { ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { businessTodayIsoDate, resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { ValidationError } from '../../errors/customErrors.js';
import { isoToJalaliDate, jalaliYearBounds } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { FiscalClosingYearRow, FiscalClosingYearsInfo } from '../../types.js';

/**
 * بسته ۳، PR «ب» (تصمیم ت۱ و ت۲ مالک محصول): کی و به چه ترتیب سال مالی بسته یا باز می‌شود.
 *
 * v9.0.122 (TD-543، B03-01): سال فقط پس از آخرین روزش بسته می‌شود؛ پیش‌تر سال جاری و حتی سال آینده بسته می‌شد و از آن
 * لحظه هیچ فاکتور، رسید یا سندی با تاریخ امروز ثبت نمی‌شد و راه بازگشایی نبود.
 */

/** تاریخ ذخیره میلادی (۱۹xx تا ۲۱xx)؛ تاریخ قدیمی دیگر (جلالی، سال بسته پیش از TD-248) جدا خوانده می‌شود */
const STORAGE_DATE_PATTERN = '^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}';

/** بستن و بازگشایی سال زیر یک قفل تراکنشی: وضعیت سال‌های دیگر که می‌سنجند تا پایان تراکنش عوض نمی‌شود */
export async function lockFiscalYearSequence(tx: DbExecutor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEYS.FISCAL_YEAR_SEQUENCE}::bigint)`);
}

function boundsOf(year: number): { firstDay: string; lastDay: string; nextFirstDay: string } {
  const bounds = jalaliYearBounds(year);
  if (!bounds) throw new ValidationError(`سال مالی «${year}» معتبر نیست.`, { field: 'year' });
  return bounds;
}

/** سال تمام شده است اگر امروزِ کسب‌وکار از نخستین روز سال بعد گذشته باشد */
export function isFiscalYearEnded(year: number, todayIso: string): boolean {
  return todayIso >= boundsOf(year).nextFirstDay;
}

/** v9.0.122 (TD-543): سالی که هنوز تمام نشده بسته نمی‌شود (۴۲۲ `FISCAL_YEAR_NOT_ENDED`) */
export function assertFiscalYearEnded(year: number, todayIso: string): void {
  if (isFiscalYearEnded(year, todayIso)) return;
  const { lastDay, nextFirstDay } = boundsOf(year);
  throw new ValidationError(
    `سال مالی ${toPersianDigits(year)} هنوز تمام نشده است؛ آخرین روز آن ${toPersianDigits(isoToJalaliDate(lastDay))} است و از ${toPersianDigits(isoToJalaliDate(nextFirstDay))} بسته می‌شود.`,
    { year, closableFrom: nextFirstDay },
    'FISCAL_YEAR_NOT_ENDED'
  );
}

/** نخستین سال مالی‌ای که سند حسابداری فعال دارد (هر وضعیت)؛ بی سند ← null */
export async function earliestVoucherYear(executor: DbExecutor = orm): Promise<number | null> {
  const res = await executor.execute(sql`
    SELECT MIN(date) FILTER (WHERE date ~ ${STORAGE_DATE_PATTERN}) AS first_iso,
           ARRAY_AGG(DISTINCT date) FILTER (WHERE date !~ ${STORAGE_DATE_PATTERN}) AS legacy_dates
      FROM journal_vouchers
     WHERE is_deleted = 0`);
  const row = (res.rows as Array<{ first_iso: string | null; legacy_dates: string[] | null }>)[0];
  const years = [
    ...(row?.first_iso ? [resolveJalaliFiscalYear(row.first_iso)] : []),
    ...(row?.legacy_dates ?? []).map(d => resolveJalaliFiscalYear(d)),
  ];
  return years.length > 0 ? Math.min(...years) : null;
}

/** سال‌های `fromYear` تا `toYear` که دست‌کم یک سند حسابداری فعال (هر وضعیت) دارند */
export async function fiscalYearsWithVouchers(executor: DbExecutor, fromYear: number, toYear: number): Promise<Set<number>> {
  const years = new Set<number>();
  if (toYear < fromYear) return years;
  const ranges = [];
  for (let year = fromYear; year <= toYear; year++) {
    const b = jalaliYearBounds(year);
    if (b) ranges.push(sql`(${year}::int, ${b.firstDay}::text, ${b.nextFirstDay}::text)`);
  }
  if (ranges.length > 0) {
    const res = await executor.execute(sql`
      SELECT y.fiscal_year
        FROM (VALUES ${sql.join(ranges, sql`, `)}) AS y(fiscal_year, first_day, next_first_day)
       WHERE EXISTS (SELECT 1 FROM journal_vouchers v
                      WHERE v.is_deleted = 0 AND v.date >= y.first_day AND v.date < y.next_first_day
                        AND v.date ~ ${STORAGE_DATE_PATTERN})`);
    for (const r of res.rows as Array<{ fiscal_year: number }>) years.add(Number(r.fiscal_year));
  }
  const legacy = await executor.execute(sql`
    SELECT DISTINCT date FROM journal_vouchers WHERE is_deleted = 0 AND date !~ ${STORAGE_DATE_PATTERN}`);
  for (const r of legacy.rows as Array<{ date: string }>) {
    const year = resolveJalaliFiscalYear(r.date);
    if (year >= fromYear && year <= toYear) years.add(year);
  }
  return years;
}

/** وضعیت سال‌های مالی برای فرم بستن سال (`GET /accounting/fiscal-closing/years`) */
export async function getFiscalClosingYears(): Promise<FiscalClosingYearsInfo> {
  const today = await businessTodayIsoDate();
  const currentYear = resolveJalaliFiscalYear(today);
  const periods = await orm.select().from(fiscalPeriods).orderBy(asc(fiscalPeriods.fiscalYear));
  const firstVoucherYear = await earliestVoucherYear();
  const firstYear = Math.min(currentYear - 1, firstVoucherYear ?? currentYear, ...periods.map(p => p.fiscalYear));
  const withVouchers = await fiscalYearsWithVouchers(orm, firstYear, currentYear - 1);
  const periodOf = new Map(periods.map(p => [p.fiscalYear, p]));

  const years: FiscalClosingYearRow[] = [];
  for (let year = firstYear; year < currentYear; year++) {
    const p = periodOf.get(year);
    years.push({
      year,
      status: p?.status === 'closed' ? 'closed' : 'open',
      hasVouchers: withVouchers.has(year),
      closedAt: p?.status === 'closed' ? serverTimestampToUtcIso(p.closedAt) : null,
      closedBy: p?.status === 'closed' ? (p.closedBy ?? null) : null,
    });
  }
  const closedYears = periods.filter(p => p.status === 'closed').map(p => p.fiscalYear);
  const reopenableYear = closedYears.length > 0 ? Math.max(...closedYears) : null;
  const openYears = years.filter(y => y.status === 'open');
  const defaultYear = openYears.length > 0 ? openYears[openYears.length - 1].year : (years.length > 0 ? years[years.length - 1].year : null);
  return { currentYear, years, defaultYear, reopenableYear };
}
