/**
 * v9.0.90 (TD-496 / B06-17, decision t6): Persian names of the warehouse and Kardex Excel exports and the message
 * shown when an export fails (a production build drops console output, so a failure has to reach the user).
 */
export const INTEGRITY_EXPORT_FILE = 'ممیزی-سلامت-انبار.xlsx';
export const TRANSACTIONS_EXPORT_FILE = 'تراکنش‌های-کاردکس.xlsx';
export const EXPORT_FAILED_MESSAGE = 'فایل اکسل ساخته نشد. دوباره تلاش کنید.';

export function kardexExportFileName(itemCode: string | number): string {
  return `کاردکس-${itemCode}.xlsx`;
}

/** `jalaliDate` as 1405/07/15; a slash is not allowed in a file name */
export function bomAllocationsExportFileName(jalaliDate: string): string {
  return `تخصیص-مواد-اولیه-${jalaliDate.replace(/\//g, '-')}.xlsx`;
}
