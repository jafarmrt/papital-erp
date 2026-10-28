import { loadXlsx } from '../../lib/excel/downloadSheet';
import { parseTreasurySheet, type ParsedTreasuryRow, type TreasuryImportMapping, emptyTreasuryMapping } from '../../lib/historyImport/treasurySheet';
import { toEnglishDigits } from '../../utils/persianNumber';

/** v11 history import, tool 1: reads every sheet of the workbook that has the shape of a money sheet. */
export async function readTreasuryWorkbook(file: File): Promise<{ rows: ParsedTreasuryRow[]; sheets: string[] }> {
  const xlsx = await loadXlsx();
  const book = xlsx.read(await file.arrayBuffer(), { type: 'array' });
  const rows: ParsedTreasuryRow[] = [];
  const sheets: string[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    // raw values: numbers stay numbers, text stays as typed (dates of the old sheets are text)
    const grid = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const parsed = parseTreasurySheet(name, grid);
    if (parsed.length > 0) { rows.push(...parsed); sheets.push(name); }
  }
  return { rows, sheets };
}

/** The Jalali month of an Excel date (`1405-02-10` or `1405/2/10` → `1405-02`), or '' when it cannot be read. */
export function monthOf(date: string): string {
  const m = /^(\d{4})[-/](\d{1,2})[-/]\d{1,2}$/.exec(toEnglishDigits(date).trim());
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : '';
}

const MAPPING_KEY = 'papital.historyImport.treasury.mapping.v1';

/** The names mapped last time, kept in this browser so next month's file asks only for new names. */
export function loadSavedMapping(): TreasuryImportMapping {
  try {
    const saved = JSON.parse(window.localStorage.getItem(MAPPING_KEY) || 'null') as TreasuryImportMapping | null;
    return saved && typeof saved === 'object' ? { ...emptyTreasuryMapping(), ...saved } : emptyTreasuryMapping();
  } catch {
    return emptyTreasuryMapping();
  }
}

export function saveMapping(mapping: TreasuryImportMapping): void {
  try {
    window.localStorage.setItem(MAPPING_KEY, JSON.stringify(mapping));
  } catch {
    // a browser without storage asks for the names again next time
  }
}
