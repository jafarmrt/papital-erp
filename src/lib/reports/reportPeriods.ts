import { isoToJalaliDate, jalaliMonthLength } from '../../utils/calendarDate.js';
import { jalaliToGregorian } from '../../utils/dateUtils.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۵): دوره‌های شمسی گزارش‌های مدیریتی، مشترک کارساز و مرورگر. بازه همیشه دو تاریخ
 * ذخیره (ISO میلادی، هر دو سر شامل) است و ماه، فصل (بهار تا زمستان، هر کدام سه ماه) و سال شمسی از آن ساخته می‌شود.
 */

export const REPORT_PERIOD_UNITS = ['month', 'quarter', 'year'] as const;
export type ReportPeriodUnit = typeof REPORT_PERIOD_UNITS[number];
export const REPORT_PERIOD_UNIT_LABELS: Record<ReportPeriodUnit, string> = { month: 'ماه', quarter: 'فصل', year: 'سال' };

export interface ReportRange {
  /** نخستین روز، ISO */
  from: string;
  /** آخرین روز (شامل)، ISO */
  to: string;
}

export const REPORT_RANGE_PRESETS = ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year', 'last_year'] as const;
export type ReportRangePreset = typeof REPORT_RANGE_PRESETS[number];
export const REPORT_RANGE_PRESET_LABELS: Record<ReportRangePreset, string> = {
  this_month: 'این ماه',
  last_month: 'ماه قبل',
  this_quarter: 'این فصل',
  last_quarter: 'فصل قبل',
  this_year: 'امسال',
  last_year: 'سال قبل',
};

export const REPORT_COMPARE_MODES = ['none', 'previous', 'last_year'] as const;
export type ReportCompareMode = typeof REPORT_COMPARE_MODES[number];
export const REPORT_COMPARE_LABELS: Record<ReportCompareMode, string> = {
  none: 'بی مقایسه',
  previous: 'دوره قبل',
  last_year: 'همان دوره سال قبل',
};

/** بیشترین شمار دوره در تفکیک دوره (۲۰ سال ماهانه) */
export const MAX_PERIOD_BUCKETS = 240;

const QUARTER_NAMES = ['بهار', 'تابستان', 'پاییز', 'زمستان'];
const MONTH_NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const UNIT_MONTHS: Record<ReportPeriodUnit, number> = { month: 1, quarter: 3, year: 12 };

const pad2 = (n: number): string => String(n).padStart(2, '0');

type JalaliDay = [number, number, number];

function jalaliOf(iso: string): JalaliDay | null {
  const jalali = isoToJalaliDate(iso);
  if (!jalali) return null;
  const [jy, jm, jd] = jalali.split('/').map(Number);
  return [jy, jm, jd];
}

function isoOf(jy: number, jm: number, jd: number): string {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${pad2(gm)}-${pad2(gd)}`;
}

const monthIndex = (jy: number, jm: number): number => jy * 12 + jm - 1;
const yearOfIndex = (index: number): number => Math.floor(index / 12);
const monthOfIndex = (index: number): number => (((index % 12) + 12) % 12) + 1;

function unitStartMonth(jm: number, unit: ReportPeriodUnit): number {
  return Math.floor((jm - 1) / UNIT_MONTHS[unit]) * UNIT_MONTHS[unit] + 1;
}

const isLastDayOfMonth = ([jy, jm, jd]: JalaliDay): boolean => jd === jalaliMonthLength(jy, jm);

/** روز شمسی `months` ماه جابه‌جا؛ روزی که در ماه مقصد نیست (۳۱ شهریور ← مهر) به آخرین روز آن ماه می‌رود */
function shiftMonths([jy, jm, jd]: JalaliDay, months: number, snapToMonthEnd: boolean): string {
  const index = monthIndex(jy, jm) + months;
  const ty = yearOfIndex(index);
  const tm = monthOfIndex(index);
  const length = jalaliMonthLength(ty, tm);
  return isoOf(ty, tm, snapToMonthEnd ? length : Math.min(jd, length));
}

/** ماه، فصل یا سال شمسیِ دربرگیرنده تاریخ، `offset` دوره جابه‌جا، به‌صورت بازه کامل */
export function unitRange(iso: string, unit: ReportPeriodUnit, offset = 0): ReportRange | null {
  const day = jalaliOf(iso);
  if (!day) return null;
  const start = monthIndex(day[0], unitStartMonth(day[1], unit)) + offset * UNIT_MONTHS[unit];
  const end = start + UNIT_MONTHS[unit] - 1;
  const ey = yearOfIndex(end);
  const em = monthOfIndex(end);
  return { from: isoOf(yearOfIndex(start), monthOfIndex(start), 1), to: isoOf(ey, em, jalaliMonthLength(ey, em)) };
}

/** میان‌برهای بازه؛ «این ماه / این فصل / امسال» تا امروز است */
export function presetRange(preset: ReportRangePreset, todayIso: string): ReportRange | null {
  const toToday = (range: ReportRange | null): ReportRange | null => (range ? { from: range.from, to: todayIso } : null);
  switch (preset) {
    case 'this_month': return toToday(unitRange(todayIso, 'month'));
    case 'last_month': return unitRange(todayIso, 'month', -1);
    case 'this_quarter': return toToday(unitRange(todayIso, 'quarter'));
    case 'last_quarter': return unitRange(todayIso, 'quarter', -1);
    case 'this_year': return toToday(unitRange(todayIso, 'year'));
    case 'last_year': return unitRange(todayIso, 'year', -1);
    default: return null;
  }
}

/** شمار روزهای بازه (هر دو سر شامل) */
export function rangeDayCount(range: ReportRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000) + 1;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/**
 * بازه مقایسه.
 * - «همان دوره سال قبل»: هر دو سر ۱۲ ماه شمسی عقب (آخرین روز ماه، آخرین روز همان ماه سال قبل می‌ماند).
 * - «دوره قبل»: چند ماه کامل ← همان شمار ماه درست پیش از آن؛ بازه‌ای که از آغاز ماه، فصل یا سال شروع شده و در همان
 *   دوره تمام می‌شود (مثلاً ماه تا امروز) ← همان روزهای دوره قبل؛ هر بازه دیگر ← همان شمار روز درست پیش از آن.
 */
export function comparisonRange(range: ReportRange, mode: ReportCompareMode): ReportRange | null {
  if (mode === 'none') return null;
  const from = jalaliOf(range.from);
  const to = jalaliOf(range.to);
  if (!from || !to || range.from > range.to) return null;
  if (mode === 'last_year') {
    return { from: shiftMonths(from, -12, false), to: shiftMonths(to, -12, isLastDayOfMonth(to)) };
  }
  if (from[2] === 1 && isLastDayOfMonth(to)) {
    const months = monthIndex(to[0], to[1]) - monthIndex(from[0], from[1]) + 1;
    return { from: shiftMonths(from, -months, false), to: shiftMonths(to, -months, true) };
  }
  for (const unit of REPORT_PERIOD_UNITS) {
    const span = unitRange(range.from, unit);
    if (span && span.from === range.from && range.to <= span.to) {
      return { from: shiftMonths(from, -UNIT_MONTHS[unit], false), to: shiftMonths(to, -UNIT_MONTHS[unit], false) };
    }
  }
  const days = rangeDayCount(range);
  const end = addDays(range.from, -1);
  return { from: addDays(end, -(days - 1)), to: end };
}

/** کلید دوره: ماه «1405/08»، فصل «1405/Q3»، سال «1405» (به ترتیب متنی هم مرتب‌اند) */
export function periodKeyOf(iso: string, unit: ReportPeriodUnit): string {
  const day = jalaliOf(iso);
  if (!day) return '';
  if (unit === 'year') return String(day[0]);
  if (unit === 'quarter') return `${day[0]}/Q${Math.floor((day[1] - 1) / 3) + 1}`;
  return `${day[0]}/${pad2(day[1])}`;
}

/** نام دوره: «آبان ۱۴۰۵»، «پاییز ۱۴۰۵»، «۱۴۰۵» */
export function periodLabel(key: string): string {
  const month = /^(\d{4})\/(\d{2})$/.exec(key);
  if (month) return `${MONTH_NAMES[Number(month[2]) - 1] ?? month[2]} ${toPersianDigits(month[1])}`;
  const quarter = /^(\d{4})\/Q([1-4])$/.exec(key);
  if (quarter) return `${QUARTER_NAMES[Number(quarter[2]) - 1]} ${toPersianDigits(quarter[1])}`;
  return /^\d{4}$/.test(key) ? toPersianDigits(key) : key;
}

export interface PeriodBucket {
  key: string;
  label: string;
  from: string;
  to: string;
}

/** دوره‌های بازه به ترتیب، هر کدام بازه کامل خودش؛ بیش از `max` دوره ← null */
export function periodBuckets(range: ReportRange, unit: ReportPeriodUnit, max = MAX_PERIOD_BUCKETS): PeriodBucket[] | null {
  const first = unitRange(range.from, unit);
  if (!first || range.from > range.to) return null;
  const buckets: PeriodBucket[] = [];
  for (let offset = 0; ; offset++) {
    const span = unitRange(range.from, unit, offset);
    if (!span || span.from > range.to) break;
    if (buckets.length >= max) return null;
    const key = periodKeyOf(span.from, unit);
    buckets.push({ key, label: periodLabel(key), from: span.from, to: span.to });
  }
  return buckets;
}

/** «۱۴۰۵/۰۷/۰۱ تا ۱۴۰۵/۰۸/۱۵» */
export function rangeLabel(range: ReportRange): string {
  return `${toPersianDigits(isoToJalaliDate(range.from))} تا ${toPersianDigits(isoToJalaliDate(range.to))}`;
}

/**
 * بخش تاریخ نام فایل خروجی: یک ماه کامل «۱۴۰۵-۰۸»، یک فصل کامل «۱۴۰۵-پاییز»، یک سال کامل «۱۴۰۵»، هر بازه دیگر
 * «۱۴۰۵-۰۷-۰۱-تا-۱۴۰۵-۰۸-۱۵».
 */
export function rangeFileTag(range: ReportRange): string {
  for (const unit of REPORT_PERIOD_UNITS) {
    const span = unitRange(range.from, unit);
    if (span && span.from === range.from && span.to === range.to) {
      const key = periodKeyOf(range.from, unit);
      if (unit === 'year') return toPersianDigits(key);
      if (unit === 'quarter') return `${toPersianDigits(key.slice(0, 4))}-${periodLabel(key).split(' ')[0]}`;
      return toPersianDigits(key.replace('/', '-'));
    }
  }
  const dash = (iso: string) => toPersianDigits(isoToJalaliDate(iso).replace(/\//g, '-'));
  return `${dash(range.from)}-تا-${dash(range.to)}`;
}

/** درصد تغییر نسبت به دوره مقایسه با یک رقم اعشار؛ پایه صفر ← null */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
