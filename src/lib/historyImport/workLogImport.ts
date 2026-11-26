import { jalaliMonthLength, toStorageDate } from '../../utils/calendarDate.js';

/**
 * v12 work-log import (start plan V12_WORKLOG_IMPORT_START_PLAN.md): the contract between the window «ورود کارکرد از اکسل»
 * and the server. The window reads the sheet «کارکرد و پروژه», the user maps each colleague, activity and project name
 * once, and the window sends one resolved row per Excel row. The server previews them (each row through the checks of a
 * hand entry, in a transaction that is rolled back) or posts them all in one transaction; one refused row posts nothing.
 * A posted row is a free work log («pending»), exactly as a hand entry, so the month's payslip takes it.
 */

/** the 1405 sheet has about 290 rows; a month has a few dozen, and the whole year fits in one post */
export const WORK_LOG_IMPORT_MAX_ROWS = 400;

export interface WorkLogImportRow {
  /** the Excel row number, for messages */
  rowNo: number;
  /** the Jalali month of the row, `YYYY-MM` (the sheet has no day; the row is dated on the month's last day) */
  month: string;
  personnelId: number;
  taskId: number;
  /** null: «بدون پروژه (عمومی و مشترک)» */
  projectId: number | null;
  /** the count, or the decimal hours of an hourly task, as decimal text */
  quantity: string;
  /** «فی» of the sheet, as decimal text in rials */
  unitRate: string;
  /** «جمع» of the sheet, as decimal text, to check quantity × rate against it (a typo shows before the post) */
  excelTotal?: string;
  /** «توضیحات» and the row of the original payroll Excel, kept in the log's notes */
  notes?: string;
  /** the user has seen that this row looks like one already in the file or the books and wants it recorded again */
  duplicateAccepted?: boolean;
}

export type WorkLogImportRowStatus = 'ok' | 'error' | 'duplicate';

export interface WorkLogImportRowOutcome {
  rowNo: number;
  status: WorkLogImportRowStatus;
  /** the day the row is (or would be) recorded on, ISO */
  date?: string;
  /** quantity × rate, as decimal text */
  amount?: string;
  /** the reason of an error or a duplicate, in Persian */
  message?: string;
  /** what the user should look at but does not stop the row (another rate than the program's, a total unlike the sheet's) */
  warnings?: string[];
}

/** one colleague's work in one month, summed on the server over the rows that go through */
export interface WorkLogImportTotal {
  personnelId: number;
  month: string;
  rows: number;
  amount: string;
}

export interface WorkLogImportResult {
  /** true only when every row was posted */
  committed: boolean;
  rows: WorkLogImportRowOutcome[];
  totals: WorkLogImportTotal[];
  okCount: number;
  errorCount: number;
  duplicateCount: number;
}

const MONTH = /^(\d{4})-(\d{2})$/;

/** `YYYY-MM` of a Jalali year and month number, or '' when either is out of range */
export function workLogMonthKey(year: number, month: number): string {
  if (!Number.isInteger(year) || year < 1390 || year > 1500 || !Number.isInteger(month) || month < 1 || month > 12) return '';
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** The first and last day (ISO) of a Jalali month `YYYY-MM`; the last day of Esfand follows the leap year. */
export function workLogMonthBounds(monthKey: string): { firstDay: string; lastDay: string } | null {
  const m = MONTH.exec(monthKey);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!workLogMonthKey(year, month)) return null;
  const firstDay = toStorageDate(`${year}/${m[2]}/01`);
  const lastDay = toStorageDate(`${year}/${m[2]}/${String(jalaliMonthLength(year, month)).padStart(2, '0')}`);
  return firstDay && lastDay ? { firstDay, lastDay } : null;
}

/**
 * The day an imported row is recorded on: the month's last day (owner's decision, 5 Azar 1405), or the colleague's service
 * end when it falls inside that month, since no work log is dated after it.
 */
export function workLogImportDate(monthKey: string, serviceEnd: string | null): string | null {
  const bounds = workLogMonthBounds(monthKey);
  if (!bounds) return null;
  if (serviceEnd && serviceEnd >= bounds.firstDay && serviceEnd < bounds.lastDay) return serviceEnd;
  return bounds.lastDay;
}

/** Two rows are the same work when they have the same colleague, activity, project, day, quantity and rate. */
export function workLogImportDuplicateKey(row: { personnelId: number; taskId: number; projectId: number | null; date: string; quantity: string; unitRate: string }): string {
  return [row.personnelId, row.taskId, row.projectId ?? 0, row.date, row.quantity, row.unitRate].join('|');
}
