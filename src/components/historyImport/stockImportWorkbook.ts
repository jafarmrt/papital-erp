import { loadXlsx } from '../../lib/excel/downloadSheet';
import { parseStockSheet, emptyStockMapping, STOCK_OPENING_DAY, type ParsedStockRow, type StockImportMapping } from '../../lib/historyImport/stockSheet';
import { monthOf } from './treasuryImportWorkbook';

/** v11 history import, tool 2: reads every sheet of the workbook that has the shape of «ورود به انبار» or «خروج دستی». */
export async function readStockWorkbook(file: File): Promise<{ rows: ParsedStockRow[]; sheets: string[] }> {
  const xlsx = await loadXlsx();
  const book = xlsx.read(await file.arrayBuffer(), { type: 'array' });
  const rows: ParsedStockRow[] = [];
  const sheets: string[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    // raw values: numbers stay numbers, text stays as typed (dates of the old sheets are text)
    const grid = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const parsed = parseStockSheet(name, grid);
    if (parsed.length > 0) { rows.push(...parsed); sheets.push(name); }
  }
  return { rows, sheets };
}

/** The month a row is posted in: opening stock in the first month, whatever its cell says. */
export function stockRowMonth(row: ParsedStockRow): string {
  const opening = row.shape === 'in' && row.typeText.replace(/[‌\s]+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim() === 'موجودی اولیه';
  return monthOf(opening ? STOCK_OPENING_DAY : row.date);
}

const MAPPING_KEY = 'papital.historyImport.stock.mapping.v1';

/** The codes and names mapped last time, kept in this browser so next month's file asks only for new ones. */
export function loadSavedStockMapping(): StockImportMapping {
  try {
    const saved = JSON.parse(window.localStorage.getItem(MAPPING_KEY) || 'null') as StockImportMapping | null;
    return saved && typeof saved === 'object' ? { ...emptyStockMapping(), ...saved } : emptyStockMapping();
  } catch {
    return emptyStockMapping();
  }
}

export function saveStockMapping(mapping: StockImportMapping): void {
  try {
    window.localStorage.setItem(MAPPING_KEY, JSON.stringify(mapping));
  } catch {
    // a browser without storage asks for the names again next time
  }
}
