/** what the user reads when the xlsx library does not load (offline, or an app tab older than the last update) */
export const XLSX_LOAD_FAILED_MESSAGE = 'ابزار اکسل بارگذاری نشد؛ اتصال را بررسی کنید و صفحه را دوباره باز کنید.';

/**
 * 10.3 package 6 (I-05, package-2 leftover): the xlsx library loads when a file is made or read, not with the page that
 * offers the button. A failed load says so in Persian, never the browser's English chunk error.
 */
export async function loadXlsx(): Promise<typeof import('xlsx')> {
  try {
    return await import('xlsx');
  } catch {
    throw new Error(XLSX_LOAD_FAILED_MESSAGE);
  }
}

/** a one-sheet xlsx download */
export async function downloadSheet(
  rows: readonly object[], sheetName: string, fileName: string, columnWidths?: Array<{ wch: number }>,
): Promise<void> {
  const xlsx = await loadXlsx();
  const sheet = xlsx.utils.json_to_sheet([...rows]);
  if (columnWidths) sheet['!cols'] = columnWidths;
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, sheetName);
  xlsx.writeFile(book, fileName);
}
