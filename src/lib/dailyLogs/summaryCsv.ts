/**
 * v9.0.235 (TD-640, finding B13-15): the CSV file of the daily work log summary report.
 *
 * Every text cell is quoted with its `"` doubled, so a name holding `"` or `,` stays in its column, and a cell that
 * starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so a spreadsheet never runs a user's
 * full name as a formula. The file name is Persian and the file is called CSV, not Excel.
 */
export interface SummaryCsvRow {
  userFullName?: string;
  username?: string;
  role?: string;
  totalHours?: number;
  daysWorked?: number;
  logsCount?: number;
  onsiteCount?: number;
  remoteCount?: number;
  avgDailyHours?: number;
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvTextCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvNumberCell(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '';
}

export const SUMMARY_CSV_HEADERS = [
  'نام و نام خانوادگی',
  'نام کاربری',
  'نقش',
  'ساعات کارکرد (ساعت)',
  'تعداد روزهای کاری',
  'تعداد گزارش‌ها',
  'روزهای حضوری',
  'روزهای دورکاری',
  'میانگین کارکرد روزانه (ساعت)',
];

/** The whole file, with a BOM so Excel reads it as UTF-8 */
export function buildSummaryCsv(rows: SummaryCsvRow[]): string {
  const lines = rows.map(u => [
    csvTextCell(u.userFullName || u.username),
    csvTextCell(u.username),
    csvTextCell(u.role || 'کاربر'),
    csvNumberCell(u.totalHours),
    csvNumberCell(u.daysWorked),
    csvNumberCell(u.logsCount),
    csvNumberCell(u.onsiteCount),
    csvNumberCell(u.remoteCount),
    csvNumberCell(u.avgDailyHours),
  ].join(','));
  return '﻿' + [SUMMARY_CSV_HEADERS.map(csvTextCell).join(','), ...lines].join('\n');
}

/** `jalaliDate` as 1405/07/15; a slash is not allowed in a file name */
export function summaryCsvFileName(mode: 'daily' | 'monthly', jalaliDate: string, year: string, month: string): string {
  return mode === 'daily'
    ? `گزارش-کار-روزانه-${jalaliDate.replace(/\//g, '-')}.csv`
    : `گزارش-کار-ماهانه-${year}-${month}.csv`;
}

export const SUMMARY_CSV_DOWNLOADED = 'فایل CSV گزارش تجمیعی دانلود شد';
