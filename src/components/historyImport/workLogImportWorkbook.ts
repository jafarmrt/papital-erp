import { loadXlsx } from '../../lib/excel/downloadSheet';
import { emptyWorkLogMapping, parseWorkLogSheet, type ParsedWorkLogRow, type WorkLogImportMapping } from '../../lib/historyImport/workLogSheet';

/** v12 work-log import: reads the first sheet of the workbook that has the shape of «کارکرد و پروژه». */
export async function readWorkLogWorkbook(file: File): Promise<{ rows: ParsedWorkLogRow[]; sheet: string }> {
  const xlsx = await loadXlsx();
  const book = xlsx.read(await file.arrayBuffer(), { type: 'array' });
  // the sheet named «کارکرد و پروژه» first, then any sheet with its columns
  const names = [...book.SheetNames].sort((a, b) => Number(b.includes('کارکرد')) - Number(a.includes('کارکرد')));
  for (const name of names) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    // raw values: numbers stay numbers (hours and rates), text stays as typed
    const grid = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const rows = parseWorkLogSheet(grid);
    if (rows.length > 0) return { rows, sheet: name };
  }
  return { rows: [], sheet: '' };
}

const MAPPING_KEY = 'papital.historyImport.workLogs.mapping.v1';

/** The names mapped last time, kept in this browser so next month's file asks only for new names. */
export function loadSavedWorkLogMapping(): WorkLogImportMapping {
  try {
    const saved = JSON.parse(window.localStorage.getItem(MAPPING_KEY) || 'null') as WorkLogImportMapping | null;
    return saved && typeof saved === 'object' ? { ...emptyWorkLogMapping(), ...saved } : emptyWorkLogMapping();
  } catch {
    return emptyWorkLogMapping();
  }
}

export function saveWorkLogMapping(mapping: WorkLogImportMapping): void {
  try {
    window.localStorage.setItem(MAPPING_KEY, JSON.stringify(mapping));
  } catch {
    // a browser without storage asks for the names again next time
  }
}
