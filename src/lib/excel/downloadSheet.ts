/**
 * 10.3 package 6 (I-05, package-2 leftover): a one-sheet xlsx download. The xlsx library loads here, when a file is
 * made, not with the page that offers the button.
 */
export async function downloadSheet(
  rows: readonly object[], sheetName: string, fileName: string, columnWidths?: Array<{ wch: number }>,
): Promise<void> {
  const xlsx = await import('xlsx');
  const sheet = xlsx.utils.json_to_sheet([...rows]);
  if (columnWidths) sheet['!cols'] = columnWidths;
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, sheetName);
  xlsx.writeFile(book, fileName);
}
