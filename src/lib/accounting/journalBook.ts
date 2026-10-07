/**
 * v9.0.213 (TD-561، B03-19): قرارداد مشترک سرور و مرورگر برای دفتر روزنامه (`GET /accounting/reports/journal-book`).
 * پاسخ یک صفحه از ردیف‌ها به ترتیب تاریخ، شماره سند و ردیف است؛ شماره ردیف و مانده تجمعی از آغاز بازه شمرده می‌شوند و
 * جمع‌ها، شمار اسناد و شمار ردیف‌ها (`total`) همه بازه را می‌گیرند. پیش‌تر کل بازه بی صفحه و هر ردیف دو بار
 * (`{ report, ...report }`) فرستاده می‌شد.
 */

export interface JournalBookRow {
  rowNumber: number;
  voucherId: number;
  voucherNumber: number;
  manualVoucherNumber?: string;
  date: string;
  voucherType: string;
  accountCode: string;
  accountName: string;
  accountLevel: string;
  detailedName?: string;
  detailedType?: string;
  currency?: string;
  description: string;
  debit: number;
  credit: number;
  /** v9.0.190 (TD-551): مبلغ خود ردیف ارزی و نرخ آن، وقتی بدهکار و بستانکار به ریال آمده است */
  originalDebit?: number;
  originalCredit?: number;
  exchangeRate?: number;
  /** مانده تجمعی بدهکار منهای بستانکار از نخستین ردیف بازه تا این ردیف */
  runningBalance: number;
}

export interface JournalBookReport {
  items: JournalBookRow[];
  /** جمع‌های همه بازه (نه فقط این صفحه) */
  totalDebit: number;
  totalCredit: number;
  /** v9.0.190 (TD-551): ارز جمع‌ها؛ نمای همه ارزها به ریال */
  reportCurrency: string;
  vouchersCount: number;
  isBalanced: boolean;
  /** شمار ردیف‌های همه بازه */
  total: number;
  page: number;
  limit: number;
}

export const JOURNAL_BOOK_PAGE_SIZE = 200;
export const JOURNAL_BOOK_MAX_PAGE_SIZE = 1000;

/** شمار صفحه‌ها (دست‌کم یک) */
export function journalBookPageCount(report: Pick<JournalBookReport, 'total' | 'limit'> | null | undefined): number {
  if (!report || !report.limit || report.total <= 0) return 1;
  return Math.ceil(report.total / report.limit);
}
