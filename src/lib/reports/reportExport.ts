import { dayFileTag, rangeFileTag, rangeLabel, type ReportRange } from './reportPeriods.js';

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۵): ابزار خروجی مشترک زبانه‌های «گزارش‌های مدیریتی». هر زبانه گزارشش را به یک
 * یا چند برگه (عنوان، سطرهای مشخصات، سرستون‌ها، ردیف‌ها و ردیف جمع) می‌دهد و همین‌جا به جدول اکسل و نام فایل فارسی
 * تبدیل می‌شود. مبلغ‌ها در اکسل عدد می‌مانند تا جمع‌پذیر باشند (§۶: خروجی اکسل به ریال است).
 */

export type ReportCell = string | number | null;

export interface ReportSheet {
  /** نام برگه (حداکثر ۳۱ نویسه در اکسل) */
  name: string;
  title: string;
  /** سطرهای مشخصات زیر عنوان: [برچسب، مقدار] */
  meta: Array<[string, string]>;
  columns: string[];
  rows: ReportCell[][];
  totals?: ReportCell[];
  /** v10.1.10: سطرهای زیر ردیف جمع (مثلاً سهم هر بازه سن) */
  footer?: ReportCell[][];
}

const MAX_SHEET_NAME = 31;

/** جدول یک برگه: عنوان، مشخصات، یک سطر خالی، سرستون‌ها، ردیف‌ها و ردیف جمع */
export function reportSheetAoa(sheet: ReportSheet): ReportCell[][] {
  return [
    [sheet.title],
    ...sheet.meta.map(([label, value]) => [label, value]),
    [],
    sheet.columns,
    ...sheet.rows,
    ...(sheet.totals ? [sheet.totals] : []),
    ...(sheet.footer ?? []),
  ];
}

/** نام برگه اکسل: بی نویسه‌های ممنوع اکسل و کوتاه‌شده تا ۳۱ نویسه */
export function reportSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, MAX_SHEET_NAME) || 'گزارش';
}

/** «گزارش-فروش-۱۴۰۵-۰۸.xlsx» از عنوان گزارش و بازه آن */
export function reportFileName(title: string, range: ReportRange): string {
  return `${title.trim().replace(/\s+/g, '-')}-${rangeFileTag(range)}.xlsx`;
}

/** v10.1.10: گزارشی که یک «تاریخ گزارش» دارد نه بازه: «سن-مطالبات-۱۴۰۵-۰۷-۲۳.xlsx» */
export function reportDayFileName(title: string, iso: string): string {
  return `${title.trim().replace(/\s+/g, '-')}-${dayFileTag(iso)}.xlsx`;
}

/** سطر مشخصات «بازه گزارش» */
export function rangeMeta(range: ReportRange): [string, string] {
  return ['بازه گزارش', rangeLabel(range)];
}
