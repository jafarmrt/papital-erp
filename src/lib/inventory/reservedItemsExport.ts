import { RIAL_DISPLAY_UNIT_LABELS } from '../rialDisplay.js';
import type { ItemReservedReportSummary, ReservedItemDetail } from './reservedItemsReport.js';

/**
 * v9.0.383 (TD-828، یافته B07-12، تصمیم ت۸): خروجی گزارش اقلام رزروشده یک فایل xlsx واقعی است با نام فارسی و تاریخ شمسی
 * («اقلام-رزروشده-1405-07-16.xlsx»)، ساخته از ردیف‌های همین تابع‌ها با کتابخانه `xlsx`. پیش‌تر دکمه «خروجی اکسل» یک CSV با
 * `encodeURI` در نشانی داده می‌ساخت: نامی با «#» فایل را قطع می‌کرد و «"» ستون‌ها را به هم می‌ریخت، نام فایل انگلیسی و میلادی
 * بود و برچسب «(ریال)» دستی نوشته شده بود. مبلغ‌های خروجی اکسل به ریال‌اند (AGENTS §۶، TD-667) و برچسبشان از جدول واحدهای
 * برنامه می‌آید؛ ستون بها فقط وقتی هست که گزارش بها دارد (TD-829).
 */
export type ReservedItemsExportRow = Record<string, string | number>;

const costHeader = (title: string) => `${title} (${RIAL_DISPLAY_UNIT_LABELS.IRR})`;

/** `jalaliDate` as 1405/07/16; a slash is not allowed in a file name */
export function reservedItemsExportFileName(jalaliDate: string): string {
  return `اقلام-رزروشده-${jalaliDate.replace(/\//g, '-')}.xlsx`;
}

export function reservedItemSummaryRows(summaries: ItemReservedReportSummary[], showCost: boolean): ReservedItemsExportRow[] {
  return summaries.map(s => ({
    'کد کالا': s.itemCode,
    'نام کالا': s.itemName,
    'دسته‌بندی': s.category,
    'واحد': s.unit,
    'موجودی کل': s.currentStock,
    'رزرو پیش‌فاکتور': s.proformaReservedQty,
    'رزرو پروژه': s.projectReservedQty,
    'مجموع رزرو': s.totalReservedQty,
    'موجودی آزاد': s.availableStock,
    ...(showCost ? { [costHeader('بهای تمام‌شده رزرو')]: s.totalReservedCost ?? 0 } : {}),
  }));
}

export function reservationEntryRows(
  entries: ReservedItemDetail[],
  showCost: boolean,
  formatDate: (value: string) => string,
): ReservedItemsExportRow[] {
  return entries.map(e => ({
    'کد کالا': e.itemCode,
    'نام کالا': e.itemName,
    'دسته‌بندی': e.category,
    'منبع رزرو': e.sourceLabel,
    'شماره منبع': e.sourceRef,
    'عنوان منبع': e.sourceTitle,
    'مقدار رزرو': e.reservedQty,
    'واحد': e.unit,
    ...(showCost ? { [costHeader('میانگین موزون بها')]: e.unitCost ?? 0, [costHeader('بهای تمام‌شده')]: e.totalCost ?? 0 } : {}),
    'تاریخ': formatDate(e.date),
  }));
}

/**
 * The page a reservation's source opens with that source: a sales proforma in the documents list searched by its number
 * (the list reads `search` from the address, `invoiceListSearchFromAddress` in `src/lib/invoices/invoiceListDocuments.ts`), a project in its inventory control page. Before,
 * the links went to `/invoices?search=` and `/projects?projectId=`, neither of which read the address.
 */
export function reservationSourcePath(entry: Pick<ReservedItemDetail, 'sourceType' | 'sourceRef' | 'sourceId'>): string {
  return entry.sourceType === 'proforma'
    ? `/invoices?search=${encodeURIComponent(entry.sourceRef)}`
    : `/project-inventory?projectId=${encodeURIComponent(String(entry.sourceId))}`;
}
