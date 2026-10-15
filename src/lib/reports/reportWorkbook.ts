import type { WorkBook, WorkSheet } from 'xlsx';
import { reportSheetAoa, reportSheetName, type ReportSheet } from './reportExport';

/**
 * v10.1.7 (D-03، طرح گزارش‌های مدیریتی §۵): ساخت و دریافت فایل اکسل گزارش‌های مدیریتی در مرورگر. کتاب‌خانه اکسل فقط
 * هنگام دریافت بار می‌شود (`import('xlsx')`)، کتاب راست‌به‌چپ است و هر برگه پهنای ستون از بلندترین خانه‌اش می‌گیرد.
 */

type XlsxModule = typeof import('xlsx');

const MIN_COLUMN_WIDTH = 8;
const MAX_COLUMN_WIDTH = 48;

function columnWidths(rows: ReadonlyArray<ReadonlyArray<unknown>>): Array<{ wch: number }> {
  const widths: number[] = [];
  rows.forEach((row, index) => {
    // سطر عنوان (نخستین سطر) یک خانه بلند است و پهنای ستون اول را نمی‌سازد
    if (index === 0) return;
    row.forEach((cell, col) => {
      const length = cell === null || cell === undefined ? 0 : String(cell).length;
      widths[col] = Math.max(widths[col] ?? 0, length);
    });
  });
  return widths.map(w => ({ wch: Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, w + 2)) }));
}

/** کتاب اکسل گزارش: هر برگه با نام یکتا و بی نویسه ممنوع */
export function buildReportWorkbook(xlsx: XlsxModule, sheets: ReportSheet[]): WorkBook {
  const book = xlsx.utils.book_new();
  book.Workbook = { Views: [{ RTL: true }] };
  const used = new Set<string>();
  for (const sheet of sheets) {
    const rows = reportSheetAoa(sheet);
    const worksheet: WorkSheet = xlsx.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = columnWidths(rows);
    const base = reportSheetName(sheet.name);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base.slice(0, 27)} ${n}`;
    used.add(name);
    xlsx.utils.book_append_sheet(book, worksheet, name);
  }
  return book;
}

export async function downloadReportWorkbook(sheets: ReportSheet[], fileName: string): Promise<void> {
  const xlsx = await import('xlsx');
  xlsx.writeFile(buildReportWorkbook(xlsx, sheets), fileName);
}
